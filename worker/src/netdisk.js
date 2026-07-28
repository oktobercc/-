/* =====================================================
   页间集 · 网盘

   两个 provider，接口一样，前端不用管你接的是哪家：
     baidu   百度网盘（OAuth 授权，只能读写 /apps/<你的应用名>/）
     webdav  任何 WebDAV 网盘（坚果云 / InfiniCloud / 群晖 / Nextcloud…）

   为什么要走后端中转：
     百度和多数 WebDAV 都不给浏览器发 CORS 头，前端直接 fetch 一定被拦，
     所以列目录、下载、上传全部由 Worker 代理一手。

   凭据存在 KV 的 nd:<uid> 里，其中 token / 密码用 AES-GCM 加密后再落盘，
   密钥从 AUTH_SECRET 派生 —— 就算 KV 被翻出来，拿到的也是密文。

   ⚠️ 关于百度：开放平台目前个人开发者认证暂不开放，只能走企业认证，
      拿不到 AppKey 的话这条 provider 是跑不起来的，先用 webdav。
===================================================== */

const BAIDU_AUTH = "https://openapi.baidu.com/oauth/2.0/authorize";
const BAIDU_TOKEN = "https://openapi.baidu.com/oauth/2.0/token";
const BAIDU_API = "https://pan.baidu.com/rest/2.0";
const BAIDU_UPLOAD = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
const BAIDU_UA = "pan.baidu.com"; // 百度的接口认这个 UA，换掉会直接被拒

const STATE_TTL = 600; // 授权 state 十分钟有效

function httpError(message, code) {
  const error = new Error(message);
  error.code = code || 400;
  return error;
}

/* =====================================================
   凭据加解密
===================================================== */

async function cryptoKey(env) {
  const secret = env.AUTH_SECRET || env.SYNC_TOKEN;
  if (!secret) throw httpError("后端没配 AUTH_SECRET", 500);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("netdisk:" + secret));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(env, plain) {
  if (!plain) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoKey(env);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    new TextEncoder().encode(String(plain))
  );

  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(packed)));
}

async function open(env, sealed) {
  if (!sealed) return "";
  try {
    const raw = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    const key = await cryptoKey(env);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      key,
      raw.slice(12)
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    // AUTH_SECRET 换过之后老密文就解不开了，当成没绑定处理
    return "";
  }
}

/* =====================================================
   绑定记录
===================================================== */

async function loadBinding(env, uid) {
  return (await env.KV.get("nd:" + uid, "json")) || null;
}

async function saveBinding(env, uid, binding) {
  await env.KV.put("nd:" + uid, JSON.stringify(binding));
}

async function clearBinding(env, uid) {
  await env.KV.delete("nd:" + uid);
}

/* =====================================================
   百度网盘
===================================================== */

function baiduRoot(env) {
  const name = env.BAIDU_APP_NAME || "";
  if (!name) throw httpError("后端没配 BAIDU_APP_NAME", 500);
  return "/apps/" + name;
}

/** 应用只能碰自己的目录，路径越权在这里挡掉 */
function guardBaiduPath(env, path) {
  const root = baiduRoot(env);
  const clean = "/" + String(path || "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");

  if (clean !== root && clean.indexOf(root + "/") !== 0) {
    throw httpError("只能访问 " + root + " 下的文件", 403);
  }
  if (clean.indexOf("..") >= 0) throw httpError("路径不合法", 400);
  return clean;
}

function baiduAuthorizeUrl(env, redirectUri, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.BAIDU_APP_KEY || "",
    redirect_uri: redirectUri,
    scope: "basic,netdisk", // 固定这两个，少一个后面接口会报 errno=-6
    state: state,
    display: "page",
  });
  return BAIDU_AUTH + "?" + params.toString();
}

async function baiduExchange(env, code, redirectUri) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    client_id: env.BAIDU_APP_KEY || "",
    client_secret: env.BAIDU_SECRET_KEY || "",
    redirect_uri: redirectUri,
  });

  const response = await fetch(BAIDU_TOKEN + "?" + params.toString(), {
    headers: { "User-Agent": BAIDU_UA },
  });
  const data = await response.json().catch(() => ({}));

  if (!data.access_token) {
    throw httpError("百度换 token 失败：" + (data.error_description || data.error || "未知原因"), 502);
  }
  return data;
}

async function baiduRefresh(env, refreshToken) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.BAIDU_APP_KEY || "",
    client_secret: env.BAIDU_SECRET_KEY || "",
  });

  const response = await fetch(BAIDU_TOKEN + "?" + params.toString(), {
    headers: { "User-Agent": BAIDU_UA },
  });
  const data = await response.json().catch(() => ({}));

  if (!data.access_token) throw httpError("百度授权过期了，需要重新绑定", 401);
  return data;
}

/** 取一个还能用的 access_token，快过期就顺手刷一次 */
async function baiduToken(env, uid, binding) {
  const soon = Date.now() + 5 * 60000;

  if (binding.expiresAt > soon && binding.access) {
    const token = await open(env, binding.access);
    if (token) return token;
  }

  const refresh = await open(env, binding.refresh);
  if (!refresh) throw httpError("网盘授权已失效，请重新绑定", 401);

  const fresh = await baiduRefresh(env, refresh);
  binding.access = await seal(env, fresh.access_token);
  // 刷新会发新的 refresh_token，一个 refresh_token 只能用一次，必须换掉
  if (fresh.refresh_token) binding.refresh = await seal(env, fresh.refresh_token);
  binding.expiresAt = Date.now() + (Number(fresh.expires_in) || 2592000) * 1000;

  await saveBinding(env, uid, binding);
  return fresh.access_token;
}

async function baiduList(env, uid, binding, dir) {
  const token = await baiduToken(env, uid, binding);
  const path = guardBaiduPath(env, dir || baiduRoot(env));

  const params = new URLSearchParams({
    method: "list",
    dir: path,
    access_token: token,
    order: "name",
    limit: "1000",
    web: "1",
  });

  const response = await fetch(BAIDU_API + "/xpan/file?" + params.toString(), {
    headers: { "User-Agent": BAIDU_UA },
  });
  const data = await response.json().catch(() => ({}));

  if (data.errno) throw httpError("百度返回 errno=" + data.errno, 502);

  return {
    dir: path,
    root: baiduRoot(env),
    entries: (data.list || []).map((item) => ({
      name: item.server_filename,
      path: item.path,
      isdir: item.isdir === 1,
      size: item.size || 0,
      mtime: (item.server_mtime || 0) * 1000,
      ref: String(item.fs_id),
    })),
  };
}

/** fs_id → 真实下载地址。dlink 有效期短，每次现取 */
async function baiduDlink(env, uid, binding, fsid) {
  const token = await baiduToken(env, uid, binding);

  const params = new URLSearchParams({
    method: "filemetas",
    access_token: token,
    fsids: "[" + String(fsid).replace(/[^\d,]/g, "") + "]",
    dlink: "1",
  });

  const response = await fetch(BAIDU_API + "/xpan/multimedia?" + params.toString(), {
    headers: { "User-Agent": BAIDU_UA },
  });
  const data = await response.json().catch(() => ({}));

  const item = (data.list || [])[0];
  if (!item || !item.dlink) throw httpError("拿不到这个文件的下载地址", 404);

  return { url: item.dlink + "&access_token=" + encodeURIComponent(token), name: item.filename, size: item.size };
}

async function baiduDownload(env, uid, binding, ref) {
  const link = await baiduDlink(env, uid, binding, ref);

  // dlink 会 302 跳转，UA 必须一路带着，否则跳完那一跳会被拒
  const response = await fetch(link.url, { headers: { "User-Agent": BAIDU_UA }, redirect: "follow" });
  if (!response.ok) throw httpError("下载失败，网盘返回 " + response.status, 502);

  return { body: response.body, name: link.name, size: link.size, type: response.headers.get("Content-Type") };
}

/**
 * 上传三步走：precreate → superfile2 逐片 → create
 * 分片 md5 由前端算好传过来（Worker 里没有现成的 MD5，
 * 而且前端本来就持有文件，在那边算最省一次搬运）
 */
async function baiduUpload(env, uid, binding, options) {
  const token = await baiduToken(env, uid, binding);
  const path = guardBaiduPath(env, options.path);
  const blockList = Array.isArray(options.blockList) ? options.blockList : [];

  if (options.action === "precreate") {
    const body = new URLSearchParams({
      path: path,
      size: String(options.size || 0),
      isdir: "0",
      autoinit: "1",
      rtype: "3", // 同名文件直接覆盖，省得网盘里堆一串 xxx(1).epub
      block_list: JSON.stringify(blockList),
    });

    const response = await fetch(BAIDU_API + "/xpan/file?method=precreate&access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "User-Agent": BAIDU_UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
    });
    const data = await response.json().catch(() => ({}));

    if (data.errno) throw httpError("precreate 失败 errno=" + data.errno, 502);
    // return_type=2 表示秒传命中，后面两步都能跳过
    return { uploadid: data.uploadid, blocks: data.block_list || [], done: data.return_type === 2 };
  }

  if (options.action === "part") {
    const params = new URLSearchParams({
      method: "upload",
      access_token: token,
      type: "tmpfile",
      path: path,
      uploadid: options.uploadid || "",
      partseq: String(options.partseq || 0),
    });

    // superfile2 收的是 multipart 表单，字段名固定叫 file
    const form = new FormData();
    form.append("file", new Blob([await options.request.arrayBuffer()]), "part");

    const response = await fetch(BAIDU_UPLOAD + "?" + params.toString(), {
      method: "POST",
      headers: { "User-Agent": BAIDU_UA },
      body: form,
    });
    const data = await response.json().catch(() => ({}));

    if (!data.md5) throw httpError("分片上传失败：" + JSON.stringify(data), 502);
    return { md5: data.md5, partseq: Number(options.partseq || 0) };
  }

  if (options.action === "create") {
    const body = new URLSearchParams({
      path: path,
      size: String(options.size || 0),
      isdir: "0",
      rtype: "3",
      uploadid: options.uploadid || "",
      block_list: JSON.stringify(blockList),
    });

    const response = await fetch(BAIDU_API + "/xpan/file?method=create&access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "User-Agent": BAIDU_UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
    });
    const data = await response.json().catch(() => ({}));

    if (data.errno) throw httpError("create 失败 errno=" + data.errno, 502);
    return { ok: true, path: data.path, size: data.size, fsid: String(data.fs_id || "") };
  }

  throw httpError("未知的上传步骤", 400);
}

/* =====================================================
   WebDAV
===================================================== */

function davRoot(binding) {
  return String(binding.base || "/").replace(/\/*$/, "/");
}

function guardDavPath(binding, path) {
  const root = davRoot(binding);
  const clean = "/" + String(path || "").replace(/^\/+/, "");

  if (clean.indexOf("..") >= 0) throw httpError("路径不合法", 400);
  if (clean + "/" !== root && clean.indexOf(root) !== 0) {
    throw httpError("只能访问 " + root + " 下的文件", 403);
  }
  return clean;
}

async function davHeaders(env, binding) {
  const password = await open(env, binding.password);

  // 解不开通常是 AUTH_SECRET 被换过。拿着空密码去连只会收到一个
  // 语焉不详的 401，不如在这里直接说清楚该干什么
  if (!password && binding.password) {
    throw httpError("网盘凭据已失效（服务端密钥变更过），请重新绑定", 401);
  }

  return {
    Authorization: "Basic " + btoa(binding.username + ":" + password),
    "User-Agent": "yejianji/1.0",
  };
}

function davUrl(binding, path) {
  return String(binding.url).replace(/\/+$/, "") + path.split("/").map(encodeURIComponent).join("/");
}

/** WebDAV 地址里可能自带一段基路径（坚果云是 /dav），
    但我们内部的路径是相对 binding.url 算的，所以要把这段前缀剥掉 */
function davPrefix(binding) {
  try {
    return new URL(binding.url).pathname.replace(/\/+$/, "");
  } catch (e) {
    return "";
  }
}

/** Workers 里没有 DOMParser，PROPFIND 的返回用正则拆，够用了 */
function parseDav(xml, selfPath, prefix) {
  const blocks = xml.match(/<[a-zA-Z0-9]*:?response[\s>][\s\S]*?<\/[a-zA-Z0-9]*:?response>/g) || [];
  const entries = [];

  blocks.forEach((block) => {
    const pick = (tag) => {
      const match = block.match(new RegExp("<[a-zA-Z0-9]*:?" + tag + "[^>]*>([\\s\\S]*?)</[a-zA-Z0-9]*:?" + tag + ">"));
      return match ? match[1].trim() : "";
    };

    let href = pick("href");
    if (!href) return;
    try {
      href = decodeURIComponent(href);
    } catch (e) {
      /* 已经是明文就用原样 */
    }

    // 服务端可能回绝对地址，也可能回 /dav/xxx 这种带基路径的绝对路径
    let path = href.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
    if (prefix && path.indexOf(prefix) === 0) path = path.slice(prefix.length);
    if (!path) path = "/";

    // 第一条永远是被查询的目录自己，跳过
    if (path === selfPath) return;

    const isdir = /<[a-zA-Z0-9]*:?collection\s*\/?>/.test(block);
    const name = decodeURIComponent(path.split("/").pop() || "");

    entries.push({
      name: name,
      path: path,
      isdir: isdir,
      size: Number(pick("getcontentlength")) || 0,
      mtime: Date.parse(pick("getlastmodified")) || 0,
      ref: path,
    });
  });

  return entries;
}

async function davList(env, binding, dir) {
  const path = guardDavPath(binding, dir || davRoot(binding));

  const response = await fetch(davUrl(binding, path.replace(/\/*$/, "/")), {
    method: "PROPFIND",
    headers: Object.assign(await davHeaders(env, binding), { Depth: "1", "Content-Type": "application/xml" }),
    body:
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>' +
      "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>",
  });

  if (response.status === 401) throw httpError("WebDAV 账号或应用密码不对", 401);
  if (response.status === 404) throw httpError("目录不存在：" + path, 404);
  if (!response.ok) throw httpError("WebDAV 返回 " + response.status, 502);

  const xml = await response.text();
  return {
    dir: path,
    root: davRoot(binding).replace(/\/$/, "") || "/",
    entries: parseDav(xml, path.replace(/\/+$/, "") || "/", davPrefix(binding)),
  };
}

async function davDownload(env, binding, ref) {
  const path = guardDavPath(binding, ref);
  const response = await fetch(davUrl(binding, path), { headers: await davHeaders(env, binding) });

  if (!response.ok) throw httpError("下载失败，WebDAV 返回 " + response.status, 502);

  return {
    body: response.body,
    name: decodeURIComponent(path.split("/").pop() || "file"),
    size: Number(response.headers.get("Content-Length")) || 0,
    type: response.headers.get("Content-Type"),
  };
}

async function davUpload(env, binding, path, request) {
  const target = guardDavPath(binding, path);

  // 先把父目录建出来，坚果云一类的服务不会自动补目录
  const segments = target.split("/").filter(Boolean);
  segments.pop();
  let walked = "";
  for (const segment of segments) {
    walked += "/" + segment;
    await fetch(davUrl(binding, walked + "/"), {
      method: "MKCOL",
      headers: await davHeaders(env, binding),
    }).catch(() => null); // 已存在会返回 405，忽略就好
  }

  const response = await fetch(davUrl(binding, target), {
    method: "PUT",
    headers: Object.assign(await davHeaders(env, binding), {
      "Content-Type": request.headers.get("Content-Type") || "application/octet-stream",
    }),
    body: request.body,
  });

  if (!response.ok) throw httpError("上传失败，WebDAV 返回 " + response.status, 502);
  return { ok: true, path: target };
}

/* =====================================================
   路由：/api/netdisk/*
===================================================== */

export async function handleNetdisk(path, url, request, env, ctx, json, readJson) {
  if (path.indexOf("/api/netdisk") !== 0) return null;

  const uid = ctx.uid;

  /* --- 授权回调：百度带着 code 打回来，此时没有 Authorization 头，
         身份靠 state 认（state 在发起时就绑好了 uid） --- */
  if (path === "/api/netdisk/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";

    const owner = await env.KV.get("st:" + state);
    if (!owner) return html("授权链接已过期，回到页面重新点一次绑定。");
    await env.KV.delete("st:" + state); // state 一次性

    if (!code) return html("授权被取消了。");

    const redirectUri = new URL(request.url).origin + "/api/netdisk/callback";
    const data = await baiduExchange(env, code, redirectUri);

    await saveBinding(env, owner, {
      provider: "baidu",
      access: await seal(env, data.access_token),
      refresh: await seal(env, data.refresh_token || ""),
      expiresAt: Date.now() + (Number(data.expires_in) || 2592000) * 1000,
      boundAt: Date.now(),
    });

    return html("绑定成功，可以关掉这个页面回到页间集了。", true);
  }

  if (!uid) return json({ error: "请先登录" }, 401, request, env);

  /* --- 当前绑定状态 --- */
  if (path === "/api/netdisk/status") {
    const binding = await loadBinding(env, uid);
    return json(
      {
        bound: !!binding,
        provider: binding ? binding.provider : "",
        root: binding ? (binding.provider === "baidu" ? baiduRoot(env) : davRoot(binding)) : "",
        boundAt: binding ? binding.boundAt : 0,
        available: {
          baidu: !!(env.BAIDU_APP_KEY && env.BAIDU_SECRET_KEY && env.BAIDU_APP_NAME),
          webdav: true,
        },
      },
      200,
      request,
      env
    );
  }

  /* --- 发起百度授权：返回一个 URL，前端把用户送过去 --- */
  if (path === "/api/netdisk/authorize" && request.method === "POST") {
    if (!env.BAIDU_APP_KEY) return json({ error: "后端没配百度 AppKey" }, 500, request, env);

    const state = crypto.randomUUID();
    await env.KV.put("st:" + state, uid, { expirationTtl: STATE_TTL });

    const redirectUri = new URL(request.url).origin + "/api/netdisk/callback";
    return json({ url: baiduAuthorizeUrl(env, redirectUri, state) }, 200, request, env);
  }

  /* --- 绑定 WebDAV：存之前先真连一次，密码错就别写进去 --- */
  if (path === "/api/netdisk/bind-webdav" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.url || !body.username || !body.password) {
      return json({ error: "地址、账号、应用密码都要填" }, 400, request, env);
    }

    const binding = {
      provider: "webdav",
      url: String(body.url).replace(/\/+$/, ""),
      username: String(body.username),
      password: await seal(env, body.password),
      base: "/" + String(body.base || "yejianji").replace(/^\/+|\/+$/g, "") + "/",
      boundAt: Date.now(),
    };

    await davList(env, binding, binding.base).catch((e) => {
      if (e.code === 404) return null; // 目录还没建，第一次上传时会补
      throw e;
    });

    await saveBinding(env, uid, binding);
    return json({ ok: true, provider: "webdav", root: binding.base }, 200, request, env);
  }

  if (path === "/api/netdisk/unbind" && request.method === "POST") {
    await clearBinding(env, uid);
    return json({ ok: true }, 200, request, env);
  }

  /* --- 下面都要求已经绑好 --- */
  const binding = await loadBinding(env, uid);
  if (!binding) return json({ error: "还没绑定网盘" }, 400, request, env);

  if (path === "/api/netdisk/list") {
    const dir = url.searchParams.get("dir") || "";
    const result = binding.provider === "baidu"
      ? await baiduList(env, uid, binding, dir)
      : await davList(env, binding, dir);
    return json(result, 200, request, env);
  }

  if (path === "/api/netdisk/download") {
    const ref = url.searchParams.get("ref") || "";
    if (!ref) return json({ error: "缺少 ref" }, 400, request, env);

    const file = binding.provider === "baidu"
      ? await baiduDownload(env, uid, binding, ref)
      : await davDownload(env, binding, ref);

    return new Response(file.body, {
      headers: Object.assign(
        {
          "Content-Type": file.type || "application/octet-stream",
          // 文件名可能有中文，用 RFC 5987 的写法，别塞进裸 filename
          "Content-Disposition":
            "attachment; filename*=UTF-8''" + encodeURIComponent(file.name || "file"),
          "X-File-Name": encodeURIComponent(file.name || "file"),
          "Access-Control-Expose-Headers": "X-File-Name,Content-Disposition",
        },
        ctx.cors
      ),
    });
  }

  if (path === "/api/netdisk/upload" && (request.method === "POST" || request.method === "PUT")) {
    const target = url.searchParams.get("path") || "";
    if (!target) return json({ error: "缺少 path" }, 400, request, env);

    if (binding.provider === "webdav") {
      return json(await davUpload(env, binding, target, request), 200, request, env);
    }

    // 百度要分步，步骤名放在 query 里
    const action = url.searchParams.get("action") || "";
    const payload = action === "part" ? {} : await readJson(request);

    const result = await baiduUpload(env, uid, binding, {
      action: action,
      path: target,
      size: payload.size || url.searchParams.get("size"),
      blockList: payload.blockList,
      uploadid: payload.uploadid || url.searchParams.get("uploadid"),
      partseq: url.searchParams.get("partseq"),
      request: request,
    });

    return json(result, 200, request, env);
  }

  return json({ error: "no such netdisk route: " + path }, 404, request, env);
}

/** 授权回调是给人看的，返回一张简单的页面 */
function html(message, ok) {
  const body =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>页间集</title><body style="font-family:system-ui,-apple-system,sans-serif;display:flex;' +
    'align-items:center;justify-content:center;height:100vh;margin:0;color:#222;background:#fff">' +
    '<div style="text-align:center;padding:24px"><div style="font-size:40px;margin-bottom:16px">' +
    (ok ? "✓" : "···") +
    '</div><p style="font-size:15px;line-height:1.8">' +
    message +
    "</p></div>" +
    (ok ? "<script>setTimeout(function(){try{window.close()}catch(e){}},1500)<\/script>" : "");

  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
