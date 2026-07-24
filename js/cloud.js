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

  var CONFIG_KEY = "cloudConfig";
  var LAST_SYNC_KEY = "cloudLastSync";
  var MAX_UPLOAD = 60 * 1024 * 1024; // 单个附件超过 60MB 就跳过，别把 R2 塞满

  var syncing = false;
  var pending = null;
  var lastError = "";

  /* ===============================
     配置
  ================================ */
  function getConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      return {
        url: (saved.url || "").replace(/\/+$/, ""),
        token: saved.token || "",
        auto: saved.auto !== false,
      };
    } catch (e) {
      return { url: "", token: "", auto: true };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        url: (config.url || "").replace(/\/+$/, ""),
        token: config.token || "",
        auto: config.auto !== false,
      })
    );
  }

  function configured() {
    var config = getConfig();
    return !!(config.url && config.token);
  }

  function lastSync() {
    return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;
  }

  /* ===============================
     请求
  ================================ */
  async function api(path, options) {
    var config = getConfig();
    if (!config.url) throw new Error("还没填后端地址");

    // 请求头只认 ASCII，口令里有中文的话浏览器会直接抛错，先说清楚
    if (/[^\x00-\x7F]/.test(config.token)) {
      throw new Error("访问口令只能用英文、数字和符号，不能有中文");
    }

    options = options || {};
    var headers = Object.assign({ Authorization: "Bearer " + config.token }, options.headers || {});

    var response = await fetch(config.url + path, {
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
      status(error.status === 401 ? "口令不对，检查一下访问口令" : "同步失败：" + error.message);
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
          console.warn("附件太大，跳过上传：" + asset.name);
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

  function putAsset(key, blob) {
    return api("/api/asset/" + encodeURIComponent(key), {
      method: "PUT",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
      raw: true,
    });
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

    var remote = await fetchAsset("asset/" + assetId);
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
    tokenInput.value = config.token;
    if (autoInput) autoInput.checked = config.auto;

    if (configured()) {
      var at = lastSync();
      status(at ? "上次同步 " + new Date(at).toLocaleString() : "已配置，还没同步过");
    } else {
      status("未配置，当前只存在这台设备上");
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

    if (!url) {
      status("后端地址不能为空");
      return;
    }

    saveConfig({ url: url, token: token, auto: auto ? auto.checked : true });
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
