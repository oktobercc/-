/* =====================================================
   页间集 · 云同步

   和 Cloudflare Worker 对接：
     书目 / 选项 / 删除记录  →  KV（/api/sync）
     封面 / 附件            →  R2（/api/asset/<key>）
     晋江起点番茄的链接导入  →  /api/import

   规则：
     · 同一本书按 updatedAt 比，谁改得晚听谁的
     · 删除记墓碑，另一台同步时才知道该删
     · 封面和附件不批量下载，用到哪张取哪张（getCover / getAsset 被接管了）

   没填后端地址时整个文件不做任何事，纯本地照常用。
===================================================== */
(function () {
  "use strict";

  // 单附件上限：500MB。大于 80MB 会自动走 multipart（每片 50MB）
  // 避开 Cloudflare 100MB 请求体的边缘限制。
  var CONFIG_KEY = "cloudConfig";
  var LAST_SYNC_KEY = "cloudLastSync";
  var MAX_UPLOAD = 500 * 1024 * 1024;
  var MULTIPART_THRESHOLD = 80 * 1024 * 1024; // 大于此值自动分片
  var MULTIPART_PART_SIZE = 50 * 1024 * 1024; // 每片 50MB，稳过 100MB 边缘限制

  var syncing = false;
  var pending = null;
  var lastError = "";

  /* ===============================
     配置
  ================================ */
  /** 现在的凭据优先是登录后的会话票；填在设置里的口令只作为
      老部署（单用户 SYNC_TOKEN）的兼容路径 */
  function credential() {
    if (window.Auth && Auth.loggedIn()) return Auth.token();
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").token || "";
    } catch (e) {
      return "";
    }
  }

  function getConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      return {
        url: (saved.url || "").replace(/\/+$/, ""),
        token: credential(),
        legacyToken: saved.token || "",
        auto: saved.auto !== false,
      };
    } catch (e) {
      return { url: "", token: credential(), legacyToken: "", auto: true };
    }
  }

  function saveConfig(config) {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    } catch (e) {
      saved = {};
    }

    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        url: (config.url || "").replace(/\/+$/, ""),
        // 只有明确传了 legacyToken 才动它，别把会话票当口令存下来
        token: config.legacyToken !== undefined ? config.legacyToken : saved.token || "",
        auto: config.auto !== false,
      })
    );
  }

  function configured() {
    var config = getConfig();
    return !!(config.token && apiBase(config));
  }

  function lastSync() {
    return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;
  }

  /* ===============================
     请求
  ================================ */
  /** 地址留空就当同源：整站部署在 Cloudflare Pages、
      后端跑在 functions/api/ 里时，接口就在自己域名下，也不存在跨域 */
  function apiBase(config) {
    if (config.url) return config.url;
    return location.protocol === "http:" || location.protocol === "https:" ? location.origin : "";
  }

  async function api(path, options) {
    var config = getConfig();
    var base = apiBase(config);
    if (!base) throw new Error("还没填后端地址");

    // 请求头只认 ASCII，口令里有中文的话浏览器会直接抛错，先说清楚
    if (/[^\x00-\x7F]/.test(config.token)) {
      throw new Error("访问口令只能用英文、数字和符号，不能有中文");
    }

    options = options || {};
    var headers = Object.assign({ Authorization: "Bearer " + config.token }, options.headers || {});

    var response = await fetch(base + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
    });

    if (!response.ok) {
      var message = "";
      try {
        message = (await response.json()).error || "";
      } catch (e) {
        message = await response.text().catch(function () {
          return "";
        });
      }
      var error = new Error(message || "后端返回 " + response.status);
      error.status = response.status;
      throw error;
    }

    return options.raw ? response : await response.json();
  }

  /* ===============================
     同步主流程
  ================================ */
  async function sync(options) {
    options = options || {};
    if (!configured()) {
      if (options.manual) status("先填后端地址和口令");
      return null;
    }
    if (syncing) return pending;

    syncing = true;
    pending = run(options).finally(function () {
      syncing = false;
    });
    return pending;
  }

  async function run(options) {
    try {
      status("正在同步…");

      var since = lastSync();
      var books = getBooks();

      // 第一次同步：本地所有书都推上去
      var outgoing = since
        ? books.filter(function (book) {
            return (Number(book.updatedAt) || 0) > since;
          })
        : books;

      var deletions = getDeletions().filter(function (record) {
        return (Number(record.at) || 0) > since;
      });

      var result = await api("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          since: since,
          books: outgoing,
          deletions: deletions,
          options: getOptions(),
        }),
      });

      var applied = applyRemote(result);
      var uploaded = await uploadAssets(result.assetKeys || []);

      localStorage.setItem(LAST_SYNC_KEY, String(result.now));
      if (deletions.length) {
        dropDeletions(
          deletions.map(function (d) {
            return d.id;
          })
        );
      }

      lastError = "";
      var parts = [];
      if (outgoing.length) parts.push("上传 " + outgoing.length + " 本");
      if (applied.updated) parts.push("下载 " + applied.updated + " 本");
      if (applied.removed) parts.push("删除 " + applied.removed + " 本");
      if (uploaded) parts.push("上传附件 " + uploaded + " 个");

      status("同步完成" + (parts.length ? "：" + parts.join("，") : "，没有变化") + " · " + clock(result.now));

      if ((applied.updated || applied.removed) && typeof window.refreshShelf === "function") {
        window.refreshShelf();
      }
      return result;
    } catch (error) {
      lastError = error.message;
      status(error.status === 401 ? "登录已过期，去「关于我 → 账号」重新登录" : "同步失败：" + error.message);
      console.warn("同步失败", error);
      return null;
    }
  }

  /** 把云端拉下来的改动合进本地 */
  function applyRemote(result) {
    var books = getBooks();
    var updated = 0;
    var removed = 0;

    (result.books || []).forEach(function (remote) {
      var index = books.findIndex(function (book) {
        return String(book.id) === String(remote.id);
      });

      if (index < 0) {
        books.push(remote);
        updated++;
      } else if ((Number(remote.updatedAt) || 0) > (Number(books[index].updatedAt) || 0)) {
        books[index] = remote;
        updated++;
      }
    });

    var goneIds = [];
    (result.deletions || []).forEach(function (record) {
      var index = books.findIndex(function (book) {
        return String(book.id) === String(record.id);
      });
      if (index < 0) return;

      // 本地改得比云端删得晚，就别删（下次会把本地版本推上去）
      if ((Number(books[index].updatedAt) || 0) > (Number(record.at) || 0)) return;

      books.splice(index, 1);
      goneIds.push(record.id);
      removed++;
    });

    if (updated || removed) {
      // 直接写，不走 saveBooks 的盖时间戳逻辑，免得把云端时间戳覆盖掉
      localStorage.setItem("books", JSON.stringify(books));
    }

    // 本地的封面附件跟着清掉
    goneIds.forEach(function (id) {
      Promise.resolve()
        .then(function () {
          return deleteCover(id);
        })
        .then(function () {
          return deleteAssetsOfBook(id);
        })
        .catch(function () {
          /* 清不掉就算了，不影响使用 */
        });
    });

    // 选项库取并集
    if (result.options) {
      ["source", "category", "tags"].forEach(function (kind) {
        (result.options[kind] || []).forEach(function (value) {
          addOption(kind, value);
        });
      });
    }

    return { updated: updated, removed: removed };
  }

  /** 云端没有的封面/附件补传上去 */
  async function uploadAssets(assetKeys) {
    var have = {};
    assetKeys.forEach(function (key) {
      have[key] = true;
    });

    var count = 0;

    try {
      var covers = (await getAllCovers()) || [];
      for (var i = 0; i < covers.length; i++) {
        var row = covers[i];
        if (!row || !row.cover) continue;
        var coverKey = "cover/" + row.id;
        if (have[coverKey]) continue;
        await putAsset(coverKey, row.cover);
        count++;
      }
    } catch (e) {
      console.warn("封面上传失败", e);
    }

    try {
      var assets = (await getAllAssets()) || [];
      for (var j = 0; j < assets.length; j++) {
        var asset = assets[j];
        if (!asset || !asset.blob) continue;

        var key = "asset/" + asset.id;
        if (have[key]) continue;

        if (asset.blob.size > MAX_UPLOAD) {
          console.warn("附件超过 500MB 上限，跳过上传：" + asset.name);
          continue;
        }
        await putAsset(key, asset.blob);
        count++;
      }
    } catch (e) {
      console.warn("附件上传失败", e);
    }

    return count;
  }

  /**
   * 单发上传（≤ 80MB）或分片上传（> 80MB）。分片由 R2 multipart API 支撑：
   *   initiate → uploadPart × N → complete
   * 任一片失败就整体 abort，别在 R2 里留半截。
   */
  async function putAsset(key, blob) {
    if (blob.size <= MULTIPART_THRESHOLD) return putAssetSingle(key, blob);
    return putAssetMultipart(key, blob);
  }

  function putAssetSingle(key, blob) {
    return api("/api/asset/" + encodeURIComponent(key), {
      method: "PUT",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
      raw: true,
    });
  }

  async function putAssetMultipart(key, blob) {
    var contentType = blob.type || "application/octet-stream";
    var init = await api(
      "/api/asset-multipart/" + encodeURIComponent(key) + "?action=init",
      { method: "POST", headers: { "Content-Type": contentType } }
    );
    var uploadId = init && init.uploadId;
    if (!uploadId) throw new Error("Worker 未返回 uploadId，检查后端版本是否已更新");

    var partCount = Math.ceil(blob.size / MULTIPART_PART_SIZE);
    var parts = [];

    try {
      for (var i = 0; i < partCount; i++) {
        var start = i * MULTIPART_PART_SIZE;
        var end = Math.min(start + MULTIPART_PART_SIZE, blob.size);
        var chunk = blob.slice(start, end);

        var partRes = await api(
          "/api/asset-multipart/" + encodeURIComponent(key) +
            "?action=part&uploadId=" + encodeURIComponent(uploadId) +
            "&partNumber=" + (i + 1),
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
          }
        );
        if (!partRes || !partRes.etag) throw new Error("片 " + (i + 1) + " 上传后没拿到 etag");
        parts.push({ partNumber: i + 1, etag: partRes.etag });
      }

      return await api(
        "/api/asset-multipart/" + encodeURIComponent(key) +
          "?action=complete&uploadId=" + encodeURIComponent(uploadId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts: parts }),
        }
      );
    } catch (err) {
      // 上传中途出错就 abort，把 R2 里已经写的碎片清掉
      try {
        await api(
          "/api/asset-multipart/" + encodeURIComponent(key) +
            "?action=abort&uploadId=" + encodeURIComponent(uploadId),
          { method: "POST" }
        );
      } catch (abortErr) {
        console.warn("abort 也失败了，需要人工清 R2", abortErr);
      }
      throw err;
    }
  }

  async function fetchAsset(key) {
    try {
      var response = await api("/api/asset/" + encodeURIComponent(key), { raw: true });
      return await response.blob();
    } catch (e) {
      if (e.status !== 404) console.warn("取云端文件失败", key, e);
      return null;
    }
  }

  /* ===============================
     用到哪张取哪张：接管 getCover / getAsset
  ================================ */
  var localGetCover = window.getCover;
  var localGetAsset = window.getAsset;

  window.getCover = async function (bookId) {
    var blob = null;
    try {
      blob = await localGetCover(bookId);
    } catch (e) {
      /* 本地没有就去云端拿 */
    }
    if (blob) return blob;
    if (!configured()) return null;

    var remote = await fetchAsset("cover/" + bookId);
    if (remote) {
      try {
        await saveCover(bookId, remote);
      } catch (e) {
        /* 存不下不影响这次显示 */
      }
    }
    return remote;
  };

  window.getAsset = async function (assetId) {
    var row = null;
    try {
      row = await localGetAsset(assetId);
    } catch (e) {
      /* 同上 */
    }
    if (row && row.blob) return row;
    if (!configured()) return row;

    var remote = await fetchAsset(assetId);
    if (!remote) return row;

    var rebuilt = { id: assetId, blob: remote, mime: remote.type, size: remote.size };
    try {
      await saveAsset(rebuilt);
    } catch (e) {
      /* 同上 */
    }
    return rebuilt;
  };

  /* ===============================
     链接导入（后端抓取）
  ================================ */
  /** 按书名 / 作者 / ISBN 搜书。site 为空表示纸质书 */
  async function searchBooks(keyword, site) {
    return await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, site: site || "" }),
    });
  }

  async function importBook(url) {
    var result = await api("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    });

    // 后端解不了 GBK（晋江）时，改用浏览器自己解码再解析一遍
    if (result.garbled) {
      var html = await proxyPage(url);
      if (html && typeof parseBookPage === "function") {
        var local = parseBookPage(html, url);
        if (local && local.title) {
          local.source = result.site;
          return { site: result.site, data: local, viaBrowser: true, missing: [] };
        }
      }
    }
    return result;
  }

  /** 拿原始字节，用浏览器的 TextDecoder 解码（GBK 这类编码浏览器一定认） */
  async function proxyPage(url) {
    var response = await api("/api/proxy?url=" + encodeURIComponent(url), { raw: true });
    var charset = response.headers.get("X-Source-Charset") || "utf-8";
    var buffer = await response.arrayBuffer();

    try {
      return new TextDecoder(charset).decode(buffer);
    } catch (e) {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }

  /** 封面图跨域拿不到，走后端转一手 */
  async function proxyImage(url) {
    try {
      var response = await api("/api/image?url=" + encodeURIComponent(url), { raw: true });
      return await response.blob();
    } catch (e) {
      console.warn("封面代理失败", e);
      return null;
    }
  }

  /* ===============================
     触发时机
  ================================ */
  var timer = null;

  window.onBooksSaved = function () {
    if (!configured() || !getConfig().auto) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      sync({ reason: "本地改动" });
    }, 2500);
  };

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (!configured() || !getConfig().auto) return;
    if (Date.now() - lastSync() < 60000) return;
    sync({ reason: "回到页面" });
  });

  document.addEventListener("DOMContentLoaded", function () {
    bindSettings();
    if (configured() && getConfig().auto) {
      setTimeout(function () {
        sync({ reason: "打开页面" });
      }, 800);
    }
  });

  /* ===============================
     关于我页面里的设置卡片
  ================================ */
  function status(text) {
    var el = document.getElementById("cloud-status");
    if (el) el.textContent = text || "";
  }

  function clock(ms) {
    var d = new Date(ms || Date.now());
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0") +
      ":" +
      String(d.getSeconds()).padStart(2, "0")
    );
  }

  function bindSettings() {
    var urlInput = document.getElementById("cloud-url");
    var tokenInput = document.getElementById("cloud-token");
    var autoInput = document.getElementById("cloud-auto");
    if (!urlInput) return;

    var config = getConfig();
    urlInput.value = config.url;
    tokenInput.value = config.legacyToken;
    if (autoInput) autoInput.checked = config.auto;

    if (configured()) {
      var at = lastSync();
      status(at ? "上次同步 " + new Date(at).toLocaleString() : "已配置，还没同步过");
    } else {
      status(
        window.Auth && Auth.loggedIn()
          ? "已登录，正在等待第一次同步"
          : "未登录，当前只存在这台设备上"
      );
    }

    if (autoInput) {
      autoInput.onchange = function () {
        var next = getConfig();
        next.auto = autoInput.checked;
        saveConfig(next);
      };
    }
  }

  async function saveCloudSettings() {
    var url = document.getElementById("cloud-url").value.trim();
    var token = document.getElementById("cloud-token").value.trim();
    var auto = document.getElementById("cloud-auto");

    // URL 可以留空：apiBase() 会 fallback 到 location.origin，
    // 这是 UI 里承诺的 Pages 同站部署形态。
    // 口令也可以留空 —— 登录之后凭据用的是会话票，这一栏只给老部署用。
    if (!token && !(window.Auth && Auth.loggedIn())) {
      status("先在上面登录，或者填入老版本的访问口令");
      return;
    }

    saveConfig({ url: url, legacyToken: token, auto: auto ? auto.checked : true });
    status("正在连接…");

    try {
      var health = await api("/api/health");
      if (!health.kv || !health.r2) {
        status("连上了，但后端没绑好：" + (health.kv ? "" : "缺 KV ") + (health.r2 ? "" : "缺 R2"));
        return;
      }
      await sync({ manual: true });
    } catch (e) {
      status("连不上：" + e.message);
    }
  }

  function forgetCloud() {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    var url = document.getElementById("cloud-url");
    var token = document.getElementById("cloud-token");
    if (url) url.value = "";
    if (token) token.value = "";
    status("已断开，本地数据保持不变");
  }

  window.CloudSync = {
    configured: configured,
    getConfig: getConfig,
    sync: sync,
    importBook: importBook,
    searchBooks: searchBooks,
    proxyImage: proxyImage,
    proxyPage: proxyPage,
    lastError: function () {
      return lastError;
    },
  };

  window.saveCloudSettings = saveCloudSettings;
  window.syncNow = function () {
    sync({ manual: true });
  };
  window.forgetCloud = forgetCloud;
})();
