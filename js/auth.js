/* =====================================================
   页间集 · 账号

   登录后拿到一张会话票，存在 localStorage，之后所有请求都带着它。
   票是后端签名的，30 天过期，过期了会自动退回未登录状态。

   ⚠️ 这里的账号密码是「页间集」自己的账号，跟你的百度账号无关。
      绑网盘走的是授权跳转，任何时候都不要在这个页面里输网盘密码。

   一台设备上换人登录时，本地那份书会被清掉再从云端重拉 ——
   不然第二个人打开就会看到第一个人的书，而且一同步就混在一起了。
===================================================== */
(function () {
  "use strict";

  var SESSION_KEY = "authSession";
  // 跟登录票分开存：退出登录、票过期都不会清掉它，只有真的换了
  // 不同的人登录，这台设备上的书架才会被清空。这样「第一次登录」
  // 和「退出后用同一个账号重新登录」都不会被误判成「换人」。
  var LIBRARY_OWNER_KEY = "libraryOwner";

  /* ===============================
     会话读写
  ================================ */
  function session() {
    try {
      var saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!saved || !saved.token) return null;
      if (saved.expiresAt && saved.expiresAt < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return saved;
    } catch (e) {
      return null;
    }
  }

  function token() {
    var current = session();
    return current ? current.token : "";
  }

  function username() {
    var current = session();
    return current ? current.username : "";
  }

  function loggedIn() {
    return !!token();
  }

  function store(username, data) {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        username: username,
        token: data.token,
        expiresAt: Date.now() + (Number(data.expiresIn) || 30 * 86400000),
      })
    );
  }

  /* ===============================
     请求
  ================================ */
  function base() {
    var url = "";
    try {
      url = (JSON.parse(localStorage.getItem("cloudConfig") || "{}").url || "").replace(/\/+$/, "");
    } catch (e) {
      /* 没配就当同源 */
    }
    if (url) return url;
    return location.protocol.indexOf("http") === 0 ? location.origin : "";
  }

  async function post(path, body) {
    var root = base();
    if (!root) throw new Error("没有后端地址，用本地服务器或部署到 Pages 再试");

    var headers = { "Content-Type": "application/json" };
    if (token()) headers.Authorization = "Bearer " + token();

    var response = await fetch(root + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {}),
    });

    var data = {};
    try {
      data = await response.json();
    } catch (e) {
      /* 后端挂了会返回 HTML，下面按状态码报错 */
    }

    if (!response.ok) {
      var error = new Error(data.error || "服务器返回 " + response.status);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /* ===============================
     换人登录时的本地清场
  ================================ */
  async function switchUser(nextName) {
    var owner = localStorage.getItem(LIBRARY_OWNER_KEY) || "";

    // 空 = 这台设备上的书从没认领给任何账号——可能是真正的第一次
    // 登录，也可能是退出登录 / 登录票过期后再登回同一个人。
    // 两种情况都不该清空，留给接下来的同步把本地的书推上去。
    if (!owner) {
      localStorage.setItem(LIBRARY_OWNER_KEY, nextName);
      return;
    }
    if (owner === nextName) return; // 同一个人，什么都不用做

    // 走到这里才是真的换了不同的人——这些都是「上一个账号」的东西，留着会串
    localStorage.removeItem("books");
    localStorage.removeItem("bookDeletions");
    localStorage.removeItem("bookOptions");
    localStorage.removeItem("cloudLastSync");

    try {
      if (typeof clearStorage === "function") await clearStorage();
    } catch (e) {
      console.warn("本地文件没清干净", e);
    }

    localStorage.setItem(LIBRARY_OWNER_KEY, nextName);
  }

  /* ===============================
     对外动作
  ================================ */
  async function login(name, password) {
    var data = await post("/api/auth/login", { username: name, password: password });
    await switchUser(data.username);
    store(data.username, data);
    return data;
  }

  async function register(name, password, invite) {
    var data = await post("/api/auth/register", {
      username: name,
      password: password,
      invite: invite || "",
    });
    await switchUser(data.username);
    store(data.username, data);
    return data;
  }

  async function changePassword(oldPassword, newPassword) {
    var data = await post("/api/auth/password", {
      username: username(),
      oldPassword: oldPassword,
      newPassword: newPassword,
    });
    if (data.token) store(username(), { token: data.token, expiresIn: 30 * 86400000 });
    return data;
  }

  /** 退出只清票，本地的书不动 —— 想清的话下次换人登录时会自动清 */
  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("cloudLastSync");
    render();
  }

  /* ===============================
     关于我 → 账号卡片
  ================================ */
  function el(id) {
    return document.getElementById(id);
  }

  function status(text, bad) {
    var node = el("auth-status");
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", !!bad);
  }

  function render() {
    var box = el("auth-card");
    if (!box) return;

    var signedIn = loggedIn();
    box.classList.toggle("signed-in", signedIn);

    var form = el("auth-form");
    var panel = el("auth-account");
    if (form) form.classList.toggle("hidden", signedIn);
    if (panel) panel.classList.toggle("hidden", !signedIn);

    var who = el("auth-who");
    if (who) who.textContent = username() || "";

    var chip = el("auth-chip");
    if (chip) chip.textContent = signedIn ? username() : "未登录";

    if (signedIn) status("已登录，书目会自动同步到你的账号");
    else status("登录后，手机和电脑上的书会自动同步");

    // 网盘卡片只在登录后有意义
    if (window.Netdisk && typeof window.Netdisk.refresh === "function") window.Netdisk.refresh();
  }

  function readForm() {
    return {
      name: (el("auth-username").value || "").trim(),
      password: el("auth-password").value || "",
      invite: el("auth-invite") ? (el("auth-invite").value || "").trim() : "",
    };
  }

  async function doLogin() {
    var form = readForm();
    if (!form.name || !form.password) return status("用户名和密码都要填", true);

    status("正在登录…");
    try {
      await login(form.name, form.password);
      render();
      if (window.CloudSync) await window.CloudSync.sync({ manual: true });
      if (typeof window.refreshShelf === "function") window.refreshShelf();
    } catch (e) {
      status(e.message, true);
    }
  }

  async function doRegister() {
    var form = readForm();
    if (!form.name || !form.password) return status("用户名和密码都要填", true);

    status("正在注册…");
    try {
      await register(form.name, form.password, form.invite);
      render();
      // 新账号第一次同步会把这台设备上已有的书全推上去
      if (window.CloudSync) await window.CloudSync.sync({ manual: true });
    } catch (e) {
      status(e.message, true);
    }
  }

  async function doChangePassword() {
    var oldPassword = prompt("原密码");
    if (oldPassword === null) return;
    var newPassword = prompt("新密码（至少 8 位，要有字母和数字）");
    if (newPassword === null) return;

    try {
      await changePassword(oldPassword, newPassword);
      status("密码改好了");
    } catch (e) {
      status(e.message, true);
    }
  }

  function doLogout() {
    if (!confirm("退出登录？这台设备上的书会留着，不会删。")) return;
    logout();
  }

  document.addEventListener("DOMContentLoaded", function () {
    render();

    // 回车直接登录
    var password = el("auth-password");
    if (password) {
      password.addEventListener("keydown", function (e) {
        if (e.key === "Enter") doLogin();
      });
    }
  });

  window.Auth = {
    token: token,
    username: username,
    loggedIn: loggedIn,
    login: login,
    register: register,
    logout: logout,
    render: render,
  };

  window.authLogin = doLogin;
  window.authRegister = doRegister;
  window.authLogout = doLogout;
  window.authChangePassword = doChangePassword;
})();
