/* =====================================================
   页间集 · Cloudflare Worker 后端

   干四件事：
     1. /api/sync    书目同步（数据放 KV，按 updatedAt 后写覆盖先写）
     2. /api/asset   封面和附件（放 R2）
     3. /api/import  抓晋江 / 起点 / 番茄的书籍信息
     4. /api/proxy   原样透传页面或图片，给前端兜底用

   除 /api/health 外都要带 Authorization: Bearer <SYNC_TOKEN>
===================================================== */

import { importBook, fetchRaw, siteOf } from "./scrape.js";

const LIBRARY_KEY = "library";
const TOMBSTONE_KEEP_DAYS = 120;
const MAX_ASSET_BYTES = 90 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight(request, env);

    try {
      if (path === "/" || path === "/api/health") {
        return json(
          {
            ok: true,
            service: "页间集 sync",
            kv: !!env.KV,
            r2: !!env.R2,
            time: Date.now(),
          },
          200,
          request,
          env
        );
      }

      const denied = checkAuth(request, env);
      if (denied) return denied;

      if (path === "/api/sync") {
        if (request.method === "POST") return await postSync(request, env);
        if (request.method === "GET") return await getSync(request, env, url);
        return json({ error: "method not allowed" }, 405, request, env);
      }

      if (path.startsWith("/api/asset/")) {
        const key = decodeURIComponent(path.slice("/api/asset/".length));
        if (!key) return json({ error: "缺少 key" }, 400, request, env);
        if (request.method === "GET") return await getAsset(key, env, request);
        if (request.method === "PUT") return await putAsset(key, request, env);
        if (request.method === "DELETE") return await deleteAsset(key, env, request);
        return json({ error: "method not allowed" }, 405, request, env);
      }

      if (path === "/api/assets") {
        return json({ keys: await listAssets(env) }, 200, request, env);
      }

      if (path === "/api/import") {
        const target = request.method === "POST" ? (await readJson(request)).url : url.searchParams.get("url");
        if (!target) return json({ error: "缺少 url" }, 400, request, env);
        const result = await importBook(target);
        return json(result, 200, request, env);
      }

      if (path === "/api/proxy" || path === "/api/image") {
        return await proxy(url.searchParams.get("url"), path === "/api/image", request, env);
      }

      return json({ error: "no such route: " + path }, 404, request, env);
    } catch (error) {
      return json(
        { error: error.message || String(error), status: error.status },
        error.code || 500,
        request,
        env
      );
    }
  },
};

/* =====================================================
   鉴权 / CORS
===================================================== */

function allowOrigin(env) {
  return env.ALLOWED_ORIGIN || "*";
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowOrigin(env),
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function checkAuth(request, env) {
  const expected = env.SYNC_TOKEN;
  if (!expected) {
    return json({ error: "后端没配置 SYNC_TOKEN，先执行 wrangler secret put SYNC_TOKEN" }, 500, request, env);
  }

  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  if (!token || !timingSafeEqual(token, expected)) {
    return json({ error: "口令不对" }, 401, request, env);
  }
  return null;
}

/** 逐字符比较，别让响应时间泄露口令长度 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(request, env)),
  });
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch (e) {
    return {};
  }
}

/* =====================================================
   同步
===================================================== */

async function loadLibrary(env) {
  const saved = await env.KV.get(LIBRARY_KEY, "json");
  return {
    books: (saved && saved.books) || [],
    options: (saved && saved.options) || {},
    deletions: (saved && saved.deletions) || [],
    updatedAt: (saved && saved.updatedAt) || 0,
  };
}

async function saveLibrary(env, library) {
  library.updatedAt = Date.now();
  await env.KV.put(LIBRARY_KEY, JSON.stringify(library));
}

async function getSync(request, env, url) {
  const since = Number(url.searchParams.get("since")) || 0;
  const library = await loadLibrary(env);
  return json(await buildPull(library, since, env), 200, request, env);
}

async function postSync(request, env) {
  const body = await readJson(request);
  const since = Number(body.since) || 0;
  const library = await loadLibrary(env);

  let changed = 0;

  /* 1. 收书：同一本按 updatedAt 比，谁新听谁的 */
  (body.books || []).forEach(function (incoming) {
    if (!incoming || incoming.id == null) return;

    const id = String(incoming.id);
    const at = Number(incoming.updatedAt) || 0;

    // 已经删掉的书，除非改动时间比删除时间还新，否则不收回来
    const tomb = library.deletions.find(function (d) {
      return String(d.id) === id;
    });
    if (tomb && at <= Number(tomb.at || 0)) return;

    const index = library.books.findIndex(function (b) {
      return String(b.id) === id;
    });

    if (index < 0) {
      incoming.serverAt = Date.now();
      library.books.push(incoming);
      changed++;
    } else if (at > (Number(library.books[index].updatedAt) || 0)) {
      incoming.serverAt = Date.now();
      library.books[index] = incoming;
      changed++;
    }

    if (tomb) {
      library.deletions = library.deletions.filter(function (d) {
        return String(d.id) !== id;
      });
    }
  });

  /* 2. 收删除 */
  (body.deletions || []).forEach(function (record) {
    if (!record || record.id == null) return;

    const id = String(record.id);
    const at = Number(record.at) || Date.now();

    const index = library.books.findIndex(function (b) {
      return String(b.id) === id;
    });
    // 删除之后又在别处改过，就不删了（改动更新）
    if (index >= 0 && (Number(library.books[index].updatedAt) || 0) > at) return;
    if (index >= 0) {
      library.books.splice(index, 1);
      changed++;
    }

    const existing = library.deletions.find(function (d) {
      return String(d.id) === id;
    });
    if (existing) {
      existing.at = Math.max(Number(existing.at) || 0, at);
      existing.serverAt = Date.now();
    } else {
      library.deletions.push({ id: record.id, at: at, serverAt: Date.now() });
    }
  });

  /* 3. 选项库取并集 */
  if (body.options) {
    ["source", "category", "tags"].forEach(function (kind) {
      const merged = (library.options[kind] || []).slice();
      (body.options[kind] || []).forEach(function (value) {
        if (value && merged.indexOf(value) < 0) merged.push(value);
      });
      library.options[kind] = merged;
    });
  }

  /* 4. 太老的墓碑清掉，KV 值别无限长（按服务端时间算，设备时钟不准也没事） */
  const cutoff = Date.now() - TOMBSTONE_KEEP_DAYS * 86400000;
  library.deletions = library.deletions.filter(function (d) {
    return (Number(d.serverAt) || Number(d.at) || 0) > cutoff;
  });

  await saveLibrary(env, library);

  const pull = await buildPull(library, since, env);
  pull.accepted = changed;
  return json(pull, 200, request, env);
}

async function buildPull(library, since, env) {
  /* 游标一律用服务端写入时间 serverAt：
     两台设备的系统时间差几分钟也不会漏同步，
     谁新谁旧的判断仍然用客户端的 updatedAt */
  const books = library.books.filter(function (b) {
    return (Number(b.serverAt) || Number(b.updatedAt) || 0) > since;
  });
  const deletions = library.deletions.filter(function (d) {
    return (Number(d.serverAt) || Number(d.at) || 0) > since;
  });

  return {
    now: Date.now(),
    full: since === 0,
    total: library.books.length,
    books: books,
    deletions: deletions,
    options: library.options,
    assetKeys: await listAssets(env),
  };
}

/* =====================================================
   R2：封面 / 附件
===================================================== */

async function listAssets(env) {
  if (!env.R2) return [];
  const keys = [];
  let cursor;

  do {
    const page = await env.R2.list({ limit: 1000, cursor: cursor });
    page.objects.forEach(function (object) {
      keys.push(object.key);
    });
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  return keys;
}

async function getAsset(key, env, request) {
  if (!env.R2) return json({ error: "没绑定 R2" }, 500, request, env);

  const object = await env.R2.get(key);
  if (!object) return json({ error: "没有这个文件" }, 404, request, env);

  const headers = Object.assign(
    {
      "Content-Type": (object.httpMetadata && object.httpMetadata.contentType) || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000",
      ETag: object.httpEtag,
    },
    corsHeaders(request, env)
  );

  return new Response(object.body, { headers: headers });
}

async function putAsset(key, request, env) {
  if (!env.R2) return json({ error: "没绑定 R2" }, 500, request, env);

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_ASSET_BYTES) {
    return json({ error: "文件太大（上限 90MB）" }, 413, request, env);
  }

  await env.R2.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
  });

  return json({ ok: true, key: key }, 200, request, env);
}

async function deleteAsset(key, env, request) {
  if (!env.R2) return json({ error: "没绑定 R2" }, 500, request, env);
  await env.R2.delete(key);
  return json({ ok: true }, 200, request, env);
}

/* =====================================================
   透传：给前端兜底解码 / 取封面图
===================================================== */

async function proxy(target, imageOnly, request, env) {
  if (!target) return json({ error: "缺少 url" }, 400, request, env);

  let host = "";
  try {
    host = new URL(target).hostname;
  } catch (e) {
    return json({ error: "url 不合法" }, 400, request, env);
  }

  // 只放行三个小说站及其图床，别把这个 Worker 变成公共代理
  const allowed = siteOf(target) || /(?:yuewen|qidian|jjwxc|fanqienovel|bytedance|byteimg|pstatp|qpic)\.(?:com|net|cn)$/i.test(host);
  if (!allowed) {
    return json({ error: "这个域名不在放行名单里：" + host }, 403, request, env);
  }

  if (imageOnly) {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Referer: new URL(target).origin + "/",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) return json({ error: "图片返回 " + response.status }, 502, request, env);

    return new Response(response.body, {
      headers: Object.assign(
        {
          "Content-Type": response.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
        corsHeaders(request, env)
      ),
    });
  }

  // 页面：原样把字节给前端，编码写在响应头里，
  // 由浏览器的 TextDecoder 去解（GBK 这类编码浏览器一定认）
  const raw = await fetchRaw(target);
  return new Response(raw.buffer, {
    status: 200,
    headers: Object.assign(
      {
        "Content-Type": "application/octet-stream",
        "X-Source-Charset": raw.charset,
        "X-Source-Status": String(raw.status),
        "X-Final-Url": encodeURI(raw.finalUrl || target),
        "Access-Control-Expose-Headers": "X-Source-Charset,X-Source-Status,X-Final-Url",
      },
      corsHeaders(request, env)
    ),
  });
}
