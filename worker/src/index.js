/* =====================================================
   页间集 · Cloudflare Worker 后端

   干几件事：
     1. /api/auth     注册 / 登录 / 改密码
     2. /api/sync     书目同步（数据放 KV，按 updatedAt 后写覆盖先写）
     3. /api/asset    封面和附件（放 R2）
     4. /api/netdisk  百度网盘 / WebDAV 的绑定、列目录、导入、备份
     5. /api/import   抓晋江 / 起点 / 番茄的书籍信息
     6. /api/proxy    原样透传页面或图片，给前端兜底用

   除 /api/health 和 /api/auth/* 外都要带
     Authorization: Bearer <登录后拿到的会话票>

   每个人的数据是隔开的：KV 走 lib:<uid>，R2 走 u/<uid>/<key>。
   老的 SYNC_TOKEN 仍然认，对应 uid = "legacy"，读写的还是升级前
   那份 library 和不带前缀的 R2 key，所以升级不会丢数据。
===================================================== */

import { importBook, fetchRaw, siteOf } from "./scrape.js";
import { searchBooks } from "./search.js";
import { handleAuth, readSession, timingSafeEqual, LEGACY_UID } from "./auth.js";
import { handleNetdisk } from "./netdisk.js";

const TOMBSTONE_KEEP_DAYS = 120;
const MAX_ASSET_BYTES = 90 * 1024 * 1024;

/** 每个人一把自己的 KV key；legacy 用户保持老 key 不动 */
function libraryKey(uid) {
  return uid === LEGACY_UID ? "library" : "lib:" + uid;
}

/** R2 也照样隔开；legacy 用户保持老 key 不动 */
function assetKey(uid, key) {
  return uid === LEGACY_UID ? key : "u/" + uid + "/" + key;
}

function stripPrefix(uid, key) {
  if (uid === LEGACY_UID) return key;
  const prefix = "u/" + uid + "/";
  return key.indexOf(prefix) === 0 ? key.slice(prefix.length) : null;
}

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

      // 注册和登录本来就是拿票的地方，不能要求先有票
      const authResponse = await handleAuth(path, request, env, json, readJson);
      if (authResponse) return authResponse;

      const uid = await resolveUid(request, env);

      // 授权回调是百度打回来的，浏览器不会带我们的会话头，放行给 netdisk 自己按 state 认
      if (path === "/api/netdisk/callback") {
        return await handleNetdisk(path, url, request, env, { uid: null, cors: corsHeaders(request, env) }, json, readJson);
      }

      if (!uid) return json({ error: "请先登录" }, 401, request, env);

      const netdiskResponse = await handleNetdisk(
        path,
        url,
        request,
        env,
        { uid: uid, cors: corsHeaders(request, env) },
        json,
        readJson
      );
      if (netdiskResponse) return netdiskResponse;

      if (path === "/api/me") {
        return json({ uid: uid, legacy: uid === LEGACY_UID }, 200, request, env);
      }

      if (path === "/api/sync") {
        if (request.method === "POST") return await postSync(request, env, uid);
        if (request.method === "GET") return await getSync(request, env, url, uid);
        return json({ error: "method not allowed" }, 405, request, env);
      }

      if (path.startsWith("/api/asset/")) {
        const key = decodeURIComponent(path.slice("/api/asset/".length));
        if (!key) return json({ error: "缺少 key" }, 400, request, env);
        if (request.method === "GET") return await getAsset(assetKey(uid, key), env, request);
        if (request.method === "PUT") return await putAsset(assetKey(uid, key), request, env);
        if (request.method === "DELETE") return await deleteAsset(assetKey(uid, key), env, request);
        return json({ error: "method not allowed" }, 405, request, env);
      }

      if (path.startsWith("/api/asset-multipart/")) {
        const key = decodeURIComponent(path.slice("/api/asset-multipart/".length));
        if (!key) return json({ error: "缺少 key" }, 400, request, env);
        return await handleMultipart(assetKey(uid, key), url, request, env);
      }

      if (path === "/api/assets") {
        return json({ keys: await listAssets(env, uid) }, 200, request, env);
      }

      if (path === "/api/search") {
        const params = request.method === "POST" ? await readJson(request) : Object.fromEntries(url.searchParams);
        const result = await searchBooks(params.q || params.keyword, params.site);
        return json(result, 200, request, env);
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

/**
 * Authorization 头里可能是两种东西：
 *   · 登录后拿到的会话票 → 解出 uid
 *   · 升级前那个 SYNC_TOKEN → 当成 legacy 用户
 * 都不是就返回 null，调用方负责回 401。
 */
async function resolveUid(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const uid = await readSession(env, token);
  if (uid) return uid;

  if (env.SYNC_TOKEN && timingSafeEqual(token, env.SYNC_TOKEN)) return LEGACY_UID;
  return null;
}

/**
 * 统一的 JSON 响应构造。
 *
 * 修复记录（2026-07-27）：
 * 之前这里只写 `status || 200`，挡得住 0 / undefined / null，
 * 但挡不住"是数字但不是合法 HTTP 状态码"的情况——比如原生
 * DOMException（crypto.subtle 抛出的那种）的 `.code` 是历史遗留的
 * 数字（SyntaxError=12、NotSupportedError=9 之类），跟 HTTP 状态码
 * 毫无关系。顶层 catch 里写的是 `error.code || 500`，这类错误的
 * `.code` 恰好是真值，就会被原样传给 `new Response(..., {status})`，
 * 而 Response 只接受 200–599，于是抛出
 * "Responses may only be constructed with status codes in the
 * range 200 to 599" 这个未捕获异常，请求直接 500 且没有正常的
 * JSON 错误体。
 *
 * 现在统一做一次合法性校验：不是 200–599 之间的整数，一律兜底成 500。
 */
function json(body, status, request, env) {
  const code = Number(status);
  const safeStatus = Number.isInteger(code) && code >= 200 && code <= 599 ? code : 500;
  return new Response(JSON.stringify(body), {
    status: safeStatus,
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

async function loadLibrary(env, uid) {
  const saved = await env.KV.get(libraryKey(uid), "json");
  return {
    books: (saved && saved.books) || [],
    options: (saved && saved.options) || {},
    deletions: (saved && saved.deletions) || [],
    updatedAt: (saved && saved.updatedAt) || 0,
  };
}

async function saveLibrary(env, uid, library) {
  library.updatedAt = Date.now();
  await env.KV.put(libraryKey(uid), JSON.stringify(library));
}

async function getSync(request, env, url, uid) {
  const since = Number(url.searchParams.get("since")) || 0;
  const library = await loadLibrary(env, uid);
  return json(await buildPull(library, since, env, uid), 200, request, env);
}

async function postSync(request, env, uid) {
  const body = await readJson(request);
  const since = Number(body.since) || 0;
  const library = await loadLibrary(env, uid);

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

  /* 2. 收删除 —— 顺带把这本书在 R2 里的封面和附件也拉一遍 key，一会儿一起清 */
  const r2ToDelete = [];
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
      const book = library.books[index];
      // 封面 key 是固定 pattern，附件 / 书摘图片走 assetId
      r2ToDelete.push("cover/" + id);
      (book.attachments || []).forEach(function (att) {
        if (att && att.assetId) r2ToDelete.push("asset/" + att.assetId);
      });
      (book.excerpts || []).forEach(function (ex) {
        (ex && ex.images ? ex.images : []).forEach(function (img) {
          if (img && img.assetId) r2ToDelete.push("asset/" + img.assetId);
        });
      });

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

  // 清 R2 孤儿：删失败不影响主流程，log 出来就行
  if (r2ToDelete.length && env.R2) {
    await Promise.all(
      r2ToDelete.map(function (key) {
        return env.R2.delete(assetKey(uid, key)).catch(function (e) {
          console.warn("R2 delete failed", key, e && e.message);
          return null;
        });
      })
    );
  }

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

  await saveLibrary(env, uid, library);

  const pull = await buildPull(library, since, env, uid);
  pull.accepted = changed;
  return json(pull, 200, request, env);
}

async function buildPull(library, since, env, uid) {
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
    assetKeys: await listAssets(env, uid),
  };
}

/* =====================================================
   R2：封面 / 附件
===================================================== */

async function listAssets(env, uid) {
  if (!env.R2) return [];

  const keys = [];
  // legacy 用户的对象没有前缀，只能全量列了再挑；新用户直接按前缀列
  const prefix = uid === LEGACY_UID ? undefined : "u/" + uid + "/";
  let cursor;

  do {
    const page = await env.R2.list({ limit: 1000, cursor: cursor, prefix: prefix });
    page.objects.forEach(function (object) {
      // legacy 要把别人的 u/xxx/ 排掉，否则会互相看见
      if (uid === LEGACY_UID && object.key.indexOf("u/") === 0) return;

      const key = stripPrefix(uid, object.key);
      if (key) keys.push(key);
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
   R2 分片上传：给大附件用（客户端切 50MB 一片依次传）

   ?action=init     POST     启动，返回 uploadId
   ?action=part     PUT      上传一片，query 里带 uploadId & partNumber
   ?action=complete POST     完成，body 是 { parts: [{partNumber, etag}, ...] }
   ?action=abort    POST     取消，清掉已上传的碎片
===================================================== */
async function handleMultipart(key, url, request, env) {
  if (!env.R2) return json({ error: "没绑定 R2" }, 500, request, env);

  const action = url.searchParams.get("action") || "";
  const uploadId = url.searchParams.get("uploadId") || "";
  const partNumber = Number(url.searchParams.get("partNumber") || 0);

  if (action === "init" && request.method === "POST") {
    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    const upload = await env.R2.createMultipartUpload(key, {
      httpMetadata: { contentType: contentType },
    });
    return json({ uploadId: upload.uploadId, key: key }, 200, request, env);
  }

  if (action === "part" && request.method === "PUT") {
    if (!uploadId || !partNumber) {
      return json({ error: "缺少 uploadId 或 partNumber" }, 400, request, env);
    }
    // 每片 ≤ 50MB，稳过 Cloudflare 100MB 边缘限制
    const resumed = env.R2.resumeMultipartUpload(key, uploadId);
    const buffer = await request.arrayBuffer();
    const part = await resumed.uploadPart(partNumber, buffer);
    return json({ partNumber: part.partNumber, etag: part.etag }, 200, request, env);
  }

  if (action === "complete" && request.method === "POST") {
    if (!uploadId) return json({ error: "缺少 uploadId" }, 400, request, env);
    const body = await readJson(request);
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length) return json({ error: "parts 是空的" }, 400, request, env);

    const resumed = env.R2.resumeMultipartUpload(key, uploadId);
    const object = await resumed.complete(parts);
    return json({ ok: true, key: key, etag: object.httpEtag }, 200, request, env);
  }

  if (action === "abort" && request.method === "POST") {
    if (!uploadId) return json({ error: "缺少 uploadId" }, 400, request, env);
    const resumed = env.R2.resumeMultipartUpload(key, uploadId);
    await resumed.abort();
    return json({ ok: true }, 200, request, env);
  }

  return json({ error: "未知 action 或 method 不符" }, 400, request, env);
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
