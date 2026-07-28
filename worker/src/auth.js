/* =====================================================
   页间集 · 用户账号

   一句话：把原来「全站一个 SYNC_TOKEN」换成「一人一个账号」。

   KV 里的东西：
     user:<小写用户名>  → { uid, username, salt, hash, iter, createdAt }
     lib:<uid>          → 这个人的书目（原来叫 library）
     nd:<uid>           → 这个人的网盘绑定（见 netdisk.js）

   会话不落库，是一段自签名的字符串：
     base64url(uid) . 过期毫秒 . HMAC-SHA256 签名
   服务端只要有 AUTH_SECRET 就能验，省一次 KV 读。

   密码存的是 PBKDF2-SHA256(10 万次) 的结果，不是明文，
   也不是能反推的东西 —— 我看不到你的密码，你忘了只能重设。

   兼容：老的 SYNC_TOKEN 仍然认，对应一个固定用户 uid = "legacy"，
   数据还在原来的 KV key 上，升级后老数据不会丢。
===================================================== */

const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const LEGACY_UID = "legacy";

/* =====================================================
   小工具
===================================================== */

function b64urlEncode(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 不在长度不同时短路，否则响应时间会泄漏长度 */
export function timingSafeEqual(a, b) {
  const bufA = utf8(String(a || ""));
  const bufB = utf8(String(b || ""));
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = new Uint8Array(len);
  const padB = new Uint8Array(len);
  padA.set(bufA);
  padB.set(bufB);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) diff |= padA[i] ^ padB[i];
  return diff === 0;
}

/* =====================================================
   密码哈希
===================================================== */

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
    key,
    256
  );
  return b64urlEncode(bits);
}

/* =====================================================
   会话签名
===================================================== */

function secretOf(env) {
  // 没单独配 AUTH_SECRET 就退回用 SYNC_TOKEN 当签名密钥，
  // 这样老部署不改环境变量也能直接跑起来
  const secret = env.AUTH_SECRET || env.SYNC_TOKEN;
  if (!secret) throw httpError("后端没配 AUTH_SECRET，先执行 wrangler secret put AUTH_SECRET", 500);
  return secret;
}

async function hmac(env, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secretOf(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8(message));
  return b64urlEncode(sig);
}

export async function issueSession(env, uid) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const payload = b64urlEncode(utf8(String(uid))) + "." + expires;
  return payload + "." + (await hmac(env, payload));
}

/** 验签 + 查过期，成功返回 uid，失败返回 null */
export async function readSession(env, token) {
  if (!token || token.indexOf(".") < 0) return null;

  const parts = String(token).split(".");
  if (parts.length !== 3) return null;

  const payload = parts[0] + "." + parts[1];
  const expected = await hmac(env, payload);
  if (!timingSafeEqual(parts[2], expected)) return null;
  if (Number(parts[1]) < Date.now()) return null;

  try {
    return new TextDecoder().decode(b64urlDecode(parts[0]));
  } catch (e) {
    return null;
  }
}

/* =====================================================
   用户增删查
===================================================== */

function httpError(message, code) {
  const error = new Error(message);
  error.code = code || 400;
  return error;
}

function normalizeName(username) {
  return String(username || "").trim().toLowerCase();
}

export function checkUsername(username) {
  const name = String(username || "").trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(name)) {
    throw httpError("用户名只能用英文、数字、下划线、点、减号，长度 3–24 位", 400);
  }
  if (name.toLowerCase() === LEGACY_UID) throw httpError("这个用户名被占用了", 409);
  return name;
}

export function checkPassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw httpError("密码至少 8 位", 400);
  if (value.length > 128) throw httpError("密码太长了", 400);
  // 太弱的挡一下：至少要有字母 + 数字
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    throw httpError("密码里至少要有字母和数字", 400);
  }
  return value;
}

export async function findUser(env, username) {
  return await env.KV.get("user:" + normalizeName(username), "json");
}

export async function createUser(env, username, password) {
  const name = checkUsername(username);
  checkPassword(password);

  if (await findUser(env, name)) throw httpError("这个用户名已经有人用了", 409);

  const salt = randomHex(16);
  const record = {
    uid: "u" + randomHex(12),
    username: name,
    salt: salt,
    iter: PBKDF2_ITER,
    hash: await pbkdf2(password, salt, PBKDF2_ITER),
    createdAt: Date.now(),
  };

  await env.KV.put("user:" + normalizeName(name), JSON.stringify(record));
  return record;
}

export async function verifyUser(env, username, password) {
  const record = await findUser(env, username);

  // 用户不存在时也照样算一次哈希，让「没这个人」和「密码错」耗时接近，
  // 免得别人靠响应时间枚举出哪些用户名是存在的
  const salt = (record && record.salt) || randomHex(16);
  const iter = (record && record.iter) || PBKDF2_ITER;
  const hash = await pbkdf2(String(password || ""), salt, iter);

  if (!record) return null;
  if (!timingSafeEqual(hash, record.hash)) return null;
  return record;
}

export async function changePassword(env, username, oldPassword, newPassword) {
  const record = await verifyUser(env, username, oldPassword);
  if (!record) throw httpError("原密码不对", 401);

  checkPassword(newPassword);
  record.salt = randomHex(16);
  record.iter = PBKDF2_ITER;
  record.hash = await pbkdf2(newPassword, record.salt, record.iter);
  record.passwordChangedAt = Date.now();

  await env.KV.put("user:" + normalizeName(record.username), JSON.stringify(record));
  return record;
}

/* =====================================================
   路由：/api/auth/*
===================================================== */

/**
 * @returns {Promise<Response|null>} 处理了就返回 Response，不是这条路由就返回 null
 */
export async function handleAuth(path, request, env, json, readJson) {
  if (path === "/api/auth/register" && request.method === "POST") {
    if (String(env.ALLOW_REGISTER || "true") === "false") {
      return json({ error: "这个站点关闭了注册" }, 403, request, env);
    }

    const body = await readJson(request);

    // 配了邀请码就必须对上，防止别人拿你的 Worker 白嫖存储
    if (env.INVITE_CODE && !timingSafeEqual(body.invite || "", env.INVITE_CODE)) {
      return json({ error: "邀请码不对" }, 403, request, env);
    }

    const user = await createUser(env, body.username, body.password);
    return json(
      {
        ok: true,
        username: user.username,
        token: await issueSession(env, user.uid),
        expiresIn: SESSION_DAYS * 86400000,
      },
      200,
      request,
      env
    );
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const user = await verifyUser(env, body.username, body.password);

    // 用户名和密码错，对外是同一句话 —— 别帮人确认账号是否存在
    if (!user) return json({ error: "用户名或密码不对" }, 401, request, env);

    return json(
      {
        ok: true,
        username: user.username,
        token: await issueSession(env, user.uid),
        expiresIn: SESSION_DAYS * 86400000,
      },
      200,
      request,
      env
    );
  }

  if (path === "/api/auth/password" && request.method === "POST") {
    const body = await readJson(request);
    const user = await changePassword(env, body.username, body.oldPassword, body.newPassword);
    // 改完密码换一张新会话票，老设备上的旧票到期自然失效
    return json({ ok: true, token: await issueSession(env, user.uid) }, 200, request, env);
  }

  return null;
}

export { LEGACY_UID };
