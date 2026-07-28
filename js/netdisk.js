/* =====================================================
   页间集 · 网盘

   两件事：
     1. 绑定  —— 百度走授权跳转，WebDAV 填地址 + 应用密码
     2. 用起来 —— 从网盘挑文件导入书架，或把整库备份丢上去

   所有请求都经后端中转（网盘不给浏览器发 CORS 头，前端直连必被拦）。

   ⚠️ 百度那条路需要后端配好 AppKey，而开放平台目前个人开发者认证
      暂不开放。没有 AppKey 就用 WebDAV，坚果云几分钟能开通。
===================================================== */
(function () {
  "use strict";

  var BLOCK_SIZE = 4 * 1024 * 1024; // 百度分片固定 4MB
  var state = { bound: false, provider: "", root: "", available: {} };
  var picking = null; // 文件浏览器打开时挂在这里的 resolve

  /* ===============================
     请求
  ================================ */
  function base() {
    var url = "";
    try {
      url = (JSON.parse(localStorage.getItem("cloudConfig") || "{}").url || "").replace(/\/+$/, "");
    } catch (e) {
      /* 同源 */
    }
    return url || (location.protocol.indexOf("http") === 0 ? location.origin : "");
  }

  async function api(path, options) {
    options = options || {};
    if (!window.Auth || !Auth.loggedIn()) throw new Error("请先登录");

    var response = await fetch(base() + path, {
      method: options.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + Auth.token() }, options.headers || {}),
      body: options.body,
    });

    if (!response.ok) {
      var message = "";
      try {
        message = (await response.json()).error || "";
      } catch (e) {
        message = "";
      }
      var error = new Error(message || "服务器返回 " + response.status);
      error.status = response.status;
      throw error;
    }

    return options.raw ? response : await response.json();
  }

  /* ===============================
     绑定
  ================================ */
  async function loadStatus() {
    if (!window.Auth || !Auth.loggedIn()) {
      state = { bound: false, provider: "", root: "", available: {} };
      return state;
    }
    try {
      state = await api("/api/netdisk/status");
    } catch (e) {
      state = { bound: false, provider: "", root: "", available: {}, error: e.message };
    }
    return state;
  }

  /** 百度：开一个新窗口去授权，回调页会自己关掉，这边轮询到绑上为止 */
  async function bindBaidu() {
    status("正在准备授权…");
    try {
      var data = await api("/api/netdisk/authorize", { method: "POST" });
      var popup = window.open(data.url, "baidu-auth", "width=520,height=680");
      if (!popup) {
        status("浏览器拦了弹窗，请允许后重试");
        return;
      }

      status("请在新窗口里完成授权…");
      var tries = 0;
      var timer = setInterval(async function () {
        tries++;
        var current = await loadStatus();

        if (current.bound) {
          clearInterval(timer);
          try {
            popup.close();
          } catch (e) {
            /* 跨域关不掉就算了 */
          }
          render();
          status("百度网盘绑好了");
        } else if (tries > 100) {
          // 大约 5 分钟没结果就别再问了
          clearInterval(timer);
          status("等太久了，如果已经授权过，点一下「刷新状态」");
        }
      }, 3000);
    } catch (e) {
      status(e.message, true);
    }
  }

  async function bindWebdav() {
    var url = (val("nd-dav-url") || "").trim();
    var username = (val("nd-dav-user") || "").trim();
    var password = val("nd-dav-pass") || "";
    var folder = (val("nd-dav-folder") || "").trim() || "yejianji";

    if (!url || !username || !password) {
      status("地址、账号、应用密码都要填", true);
      return;
    }

    status("正在连接…");
    try {
      await api("/api/netdisk/bind-webdav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, username: username, password: password, base: folder }),
      });

      var pass = document.getElementById("nd-dav-pass");
      if (pass) pass.value = ""; // 密码存后端了，输入框别留着
      await loadStatus();
      render();
      status("绑好了");
    } catch (e) {
      status(e.message, true);
    }
  }

  async function unbind() {
    if (!confirm("解除网盘绑定？网盘里已有的文件不会被删。")) return;
    try {
      await api("/api/netdisk/unbind", { method: "POST" });
      await loadStatus();
      render();
      status("已解绑");
    } catch (e) {
      status(e.message, true);
    }
  }

  /* ===============================
     列目录 / 下载
  ================================ */
  function listDir(dir) {
    return api("/api/netdisk/list?dir=" + encodeURIComponent(dir || ""));
  }

  async function download(ref, onProgress) {
    var response = await api("/api/netdisk/download?ref=" + encodeURIComponent(ref), { raw: true });

    var total = Number(response.headers.get("Content-Length")) || 0;
    var name = "";
    try {
      name = decodeURIComponent(response.headers.get("X-File-Name") || "");
    } catch (e) {
      name = "";
    }

    // 没有进度回调就直接要 blob，省一次手工拼装
    if (!onProgress || !response.body) {
      return { name: name, blob: await response.blob() };
    }

    var reader = response.body.getReader();
    var chunks = [];
    var received = 0;

    while (true) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.length;
      onProgress(received, total);
    }

    return { name: name, blob: new Blob(chunks) };
  }

  /* ===============================
     上传
  ================================ */
  async function upload(path, blob, onProgress) {
    if (!state.bound) throw new Error("还没绑定网盘");

    if (state.provider === "webdav") {
      // WebDAV 一次 PUT 就完事
      await api("/api/netdisk/upload?path=" + encodeURIComponent(path), {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      if (onProgress) onProgress(blob.size, blob.size);
      return { ok: true, path: path };
    }

    // 百度：precreate → 逐片 → create
    if (typeof md5Blocks !== "function") throw new Error("缺少 js/md5.js");

    if (onProgress) onProgress(0, blob.size);
    var blocks = await md5Blocks(blob, BLOCK_SIZE);

    var pre = await api("/api/netdisk/upload?action=precreate&path=" + encodeURIComponent(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: blob.size, blockList: blocks }),
    });

    // 秒传命中，剩下两步都不用做了
    if (pre.done) {
      if (onProgress) onProgress(blob.size, blob.size);
      return { ok: true, path: path, instant: true };
    }

    for (var i = 0; i < blocks.length; i++) {
      var slice = blob.slice(i * BLOCK_SIZE, Math.min((i + 1) * BLOCK_SIZE, blob.size));
      await api(
        "/api/netdisk/upload?action=part&path=" + encodeURIComponent(path) +
          "&uploadid=" + encodeURIComponent(pre.uploadid) +
          "&partseq=" + i,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: slice,
        }
      );
      if (onProgress) onProgress(Math.min((i + 1) * BLOCK_SIZE, blob.size), blob.size);
    }

    return await api("/api/netdisk/upload?action=create&path=" + encodeURIComponent(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: blob.size, blockList: blocks, uploadid: pre.uploadid }),
    });
  }

  /* ===============================
     文件浏览器
     动态建 DOM，这样每个页面只要引这个 js 就有得用
  ================================ */
  function buildBrowser() {
    var existing = document.getElementById("nd-browser");
    if (existing) return existing;

    var box = document.createElement("div");
    box.id = "nd-browser";
    box.className = "nd-mask hidden";
    box.innerHTML =
      '<div class="nd-panel">' +
      '  <div class="nd-head">' +
      '    <h3>从网盘选择</h3>' +
      '    <button class="nd-close" type="button">✕</button>' +
      "  </div>" +
      '  <div class="nd-path" id="nd-path"></div>' +
      '  <div class="nd-list" id="nd-list"></div>' +
      '  <div class="nd-foot">' +
      '    <span class="nd-tip" id="nd-tip"></span>' +
      '    <button class="btn btn-secondary nd-cancel" type="button">取消</button>' +
      "  </div>" +
      "</div>";

    document.body.appendChild(box);

    box.querySelector(".nd-close").onclick = closeBrowser;
    box.querySelector(".nd-cancel").onclick = closeBrowser;
    box.addEventListener("click", function (e) {
      if (e.target === box) closeBrowser(); // 点遮罩关掉
    });

    return box;
  }

  function closeBrowser() {
    var box = document.getElementById("nd-browser");
    if (box) box.classList.add("hidden");
    if (picking) {
      picking(null); // 取消 = 交回 null，调用方自己判断
      picking = null;
    }
  }

  function tip(text) {
    var node = document.getElementById("nd-tip");
    if (node) node.textContent = text || "";
  }

  async function openDir(dir) {
    var list = document.getElementById("nd-list");
    var pathBar = document.getElementById("nd-path");
    list.innerHTML = '<div class="nd-empty">正在读取…</div>';

    var data;
    try {
      data = await listDir(dir);
    } catch (e) {
      list.innerHTML = '<div class="nd-empty">读取失败：' + escapeHtml(e.message) + "</div>";
      return;
    }

    // 面包屑：根目录 + 一路下来的每一层
    var root = data.root || "/";
    var rest = data.dir.indexOf(root) === 0 ? data.dir.slice(root.length) : "";
    var parts = rest.split("/").filter(Boolean);

    pathBar.innerHTML = "";
    appendCrumb(pathBar, "网盘根目录", root);
    var walked = root;
    parts.forEach(function (part) {
      walked = walked.replace(/\/$/, "") + "/" + part;
      pathBar.appendChild(document.createTextNode(" / "));
      appendCrumb(pathBar, part, walked);
    });

    if (!data.entries.length) {
      list.innerHTML = '<div class="nd-empty">这个目录是空的</div>';
      return;
    }

    // 目录排前面，同类按名字排
    data.entries.sort(function (a, b) {
      if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh");
    });

    list.innerHTML = "";
    data.entries.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "nd-item" + (entry.isdir ? " is-dir" : "");
      row.innerHTML =
        '<span class="nd-icon">' + (entry.isdir ? "▸" : "▤") + "</span>" +
        '<span class="nd-name">' + escapeHtml(entry.name) + "</span>" +
        '<span class="nd-size">' +
        (entry.isdir ? "" : typeof formatSize === "function" ? formatSize(entry.size) : entry.size + " B") +
        "</span>";

      row.onclick = function () {
        if (entry.isdir) return openDir(entry.path);
        takeFile(entry);
      };

      list.appendChild(row);
    });
  }

  function appendCrumb(bar, label, dir) {
    var link = document.createElement("button");
    link.type = "button";
    link.className = "nd-crumb";
    link.textContent = label;
    link.onclick = function () {
      openDir(dir);
    };
    bar.appendChild(link);
  }

  async function takeFile(entry) {
    tip("正在下载 " + entry.name + "…");
    try {
      var file = await download(entry.ref, function (received, total) {
        tip(
          "正在下载 " + entry.name + "… " +
            (total ? Math.round((received / total) * 100) + "%" : Math.round(received / 1024) + " KB")
        );
      });

      // 交给调用方的是标准 File，跟本地选文件走同一条路
      var result = new File([file.blob], file.name || entry.name, {
        type: file.blob.type || "application/octet-stream",
        lastModified: entry.mtime || Date.now(),
      });

      var done = picking;
      picking = null;
      document.getElementById("nd-browser").classList.add("hidden");
      tip("");
      if (done) done(result);
    } catch (e) {
      tip("下载失败：" + e.message);
    }
  }

  /**
   * 打开浏览器让用户挑一个文件。
   * @returns {Promise<File|null>} 取消返回 null
   */
  function pickFile() {
    if (!state.bound) {
      alert("还没绑定网盘，去「关于我 → 网盘」绑一个。");
      return Promise.resolve(null);
    }

    var box = buildBrowser();
    box.classList.remove("hidden");
    tip("");
    openDir(state.root);

    return new Promise(function (resolve) {
      picking = resolve;
    });
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ===============================
     整库备份到网盘 / 从网盘恢复
     格式跟「导出备份」完全一样，两边可以互相导
  ================================ */
  async function backup() {
    if (!state.bound) return status("还没绑定网盘", true);

    status("正在打包…");
    try {
      var payload = {
        format: "yejianji-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        books: getBooks(),
        options: getOptions(),
        covers: {},
        assets: [],
      };

      var covers = (await getAllCovers()) || [];
      for (var i = 0; i < covers.length; i++) {
        if (!covers[i] || !covers[i].cover) continue;
        payload.covers[covers[i].id] = {
          mime: covers[i].cover.type || "image/jpeg",
          data: await blobToBase64(covers[i].cover),
        };
      }

      // 附件动辄几百 MB，默认不塞进备份 —— 它们本来就在网盘里躺着
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      var name = "备份/页间集-" + new Date().toISOString().slice(0, 10) + ".json";
      var path = state.root.replace(/\/$/, "") + "/" + name;

      await upload(path, blob, function (sent, total) {
        status("正在上传… " + Math.round((sent / total) * 100) + "%");
      });

      status("已备份 " + payload.books.length + " 本书到网盘：" + name);
    } catch (e) {
      status("备份失败：" + e.message, true);
    }
  }

  async function restore() {
    var file = await pickFile();
    if (!file) return;

    if (!/\.json$/i.test(file.name)) {
      status("请选一个页间集导出的 .json 备份", true);
      return;
    }
    if (typeof importBackup !== "function") {
      status("备份模块没加载", true);
      return;
    }

    await importBackup(file); // 合并逻辑跟本地导入完全一样，会先弹确认
    status("恢复流程已交给「数据备份」那一栏");
  }

  async function blobToBase64(blob) {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var chunk = 0x8000;
    var binary = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /* ===============================
     关于我 → 网盘卡片
  ================================ */
  function val(id) {
    var node = document.getElementById(id);
    return node ? node.value : "";
  }

  function status(text, bad) {
    var node = document.getElementById("nd-status");
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", !!bad);
  }

  function render() {
    var card = document.getElementById("nd-card");
    if (!card) return;

    var signedIn = window.Auth && Auth.loggedIn();
    var needLogin = document.getElementById("nd-need-login");
    var forms = document.getElementById("nd-forms");
    var bound = document.getElementById("nd-bound");

    if (needLogin) needLogin.classList.toggle("hidden", !!signedIn);
    if (forms) forms.classList.toggle("hidden", !signedIn || state.bound);
    if (bound) bound.classList.toggle("hidden", !signedIn || !state.bound);

    var baiduRow = document.getElementById("nd-baidu-row");
    if (baiduRow) {
      // 后端没配 AppKey 就别给按钮，点了也只会报错
      var ready = state.available && state.available.baidu;
      baiduRow.classList.toggle("nd-off", !ready);
      var button = document.getElementById("nd-baidu-btn");
      if (button) {
        button.disabled = !ready;
        button.textContent = ready ? "去百度授权" : "后端未配置百度 AppKey";
      }
    }

    var label = document.getElementById("nd-bound-label");
    if (label) {
      label.textContent =
        (state.provider === "baidu" ? "百度网盘" : "WebDAV") + " · " + (state.root || "/");
    }

    if (signedIn && !state.bound) status("绑定后可以从网盘导入电子书，也能把书库备份上去");
  }

  async function refresh() {
    await loadStatus();
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (window.Auth && Auth.loggedIn()) refresh();
    else render();
  });

  window.Netdisk = {
    refresh: refresh,
    pickFile: pickFile,
    upload: upload,
    download: download,
    listDir: listDir,
    bound: function () {
      return !!state.bound;
    },
  };

  window.netdiskBindBaidu = bindBaidu;
  window.netdiskBindWebdav = bindWebdav;
  window.netdiskUnbind = unbind;
  window.netdiskRefresh = refresh;
  window.netdiskBackup = backup;
  window.netdiskRestore = restore;
})();
