/* =====================================================
   页间集 · 备份与迁移

   这个应用是纯静态页面，书目存在 localStorage、封面和附件存在
   IndexedDB —— 两者都绑在「这台设备的这个浏览器」上，手机和电脑
   各存各的，不会自己同步。要搬家就走这里：一台导出成 .json，
   另一台导入。

   导出内容：书目 + 自建选项（来源/分类/标签）+ 封面，
   附件文件（EPUB/PDF 等）体积大，导出时单独问一次。
===================================================== */
(function () {
  "use strict";

  var FORMAT = "yejianji-backup";
  var VERSION = 1;

  function status(text) {
    var el = document.getElementById("backup-status");
    if (el) el.textContent = text || "";
    if (text && window.ShelfActions && ShelfActions.toast) return;
  }

  async function blobToBase64(blob) {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var chunk = 0x8000; // 一次别喂太多，否则 apply 会爆栈
    var binary = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBlob(base64, mime) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  function humanSize(bytes) {
    return typeof formatSize === "function" ? formatSize(bytes) : Math.round(bytes / 1024) + " KB";
  }

  /* ===============================
     导出
  ================================ */
  async function exportBackup() {
    try {
      status("正在打包…");

      var books = getBooks();
      if (!books.length) {
        status("书架是空的，没什么可导出");
        return;
      }

      var payload = {
        format: FORMAT,
        version: VERSION,
        exportedAt: new Date().toISOString(),
        books: books,
        options: getOptions(),
        covers: {},
        assets: [],
      };

      // 封面（一张几十 KB，一律带上）
      var covers = [];
      try {
        covers = (await getAllCovers()) || [];
      } catch (e) {
        console.warn("封面读取失败", e);
      }

      for (var i = 0; i < covers.length; i++) {
        if (!covers[i] || !covers[i].cover) continue;
        payload.covers[covers[i].id] = {
          mime: covers[i].cover.type || "image/jpeg",
          data: await blobToBase64(covers[i].cover),
        };
      }

      // 附件（EPUB/PDF 动辄几 MB，问一句再决定）
      var assets = [];
      try {
        assets = (await getAllAssets()) || [];
      } catch (e) {
        console.warn("附件读取失败", e);
      }

      var withBlob = assets.filter(function (a) {
        return a && a.blob;
      });
      var total = withBlob.reduce(function (sum, a) {
        return sum + (a.blob.size || 0);
      }, 0);

      var includeAssets =
        withBlob.length > 0 &&
        confirm(
          "要把附件文件也打包进去吗？\n\n共 " +
            withBlob.length +
            " 个文件，约 " +
            humanSize(total) +
            "。\n\n确定 = 包含附件（文件大，但另一台设备能直接下载原书）\n取消 = 只备份书目、封面、书摘图片以外的信息（文件小，传输快）"
        );

      if (includeAssets) {
        for (var j = 0; j < withBlob.length; j++) {
          status("正在打包附件 " + (j + 1) + " / " + withBlob.length + "…");
          payload.assets.push({
            id: withBlob[j].id,
            bookId: withBlob[j].bookId,
            kind: withBlob[j].kind,
            name: withBlob[j].name,
            mime: withBlob[j].mime || (withBlob[j].blob && withBlob[j].blob.type) || "",
            size: withBlob[j].size || withBlob[j].blob.size,
            data: await blobToBase64(withBlob[j].blob),
          });
        }
      }

      var json = JSON.stringify(payload);
      var blob = new Blob([json], { type: "application/json" });
      var name = "页间集备份-" + new Date().toISOString().slice(0, 10) + ".json";

      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 3000);

      status(
        "已导出 " +
          books.length +
          " 本书（" +
          humanSize(blob.size) +
          "）" +
          (includeAssets ? "，含附件" : "，不含附件")
      );
    } catch (e) {
      console.error(e);
      status("导出失败：" + e.message);
    }
  }

  /* ===============================
     导入
  ================================ */
  function pickBackupFile() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = function (e) {
      var file = e.target.files[0];
      if (file) importBackup(file);
    };
    input.click();
  }

  async function importBackup(file) {
    try {
      status("正在读取备份…");
      var payload = JSON.parse(await file.text());

      if (!payload || payload.format !== FORMAT || !Array.isArray(payload.books)) {
        status("这不是页间集的备份文件");
        return;
      }

      var current = getBooks();
      var incoming = payload.books;

      var sameId = incoming.filter(function (book) {
        return current.some(function (b) {
          return String(b.id) === String(book.id);
        });
      }).length;

      var message =
        "备份里有 " +
        incoming.length +
        " 本书（" +
        (payload.exportedAt || "").slice(0, 10) +
        " 导出）。\n\n" +
        "确定后会合并到当前书架：新书直接加进来" +
        (sameId ? "，其中 " + sameId + " 本 id 相同的会被备份里的版本覆盖" : "") +
        "。\n当前书架上的其他书不受影响。";

      if (!confirm(message)) {
        status("已取消");
        return;
      }

      // 1. 书目：按 id 合并
      var merged = current.slice();
      incoming.forEach(function (book) {
        var index = merged.findIndex(function (b) {
          return String(b.id) === String(book.id);
        });
        if (index >= 0) merged[index] = book;
        else merged.push(book);
      });
      saveBooks(merged);

      // 2. 选项：备份里的选项库 + 书上实际用到的标签/分类/来源，一起并进去，
      //    免得导入后书上有标签、筛选框里却没有
      if (payload.options) {
        ["source", "category", "tags"].forEach(function (kind) {
          (payload.options[kind] || []).forEach(function (value) {
            addOption(kind, value);
          });
        });
      }

      incoming.forEach(function (book) {
        (book.tags || []).forEach(function (tag) {
          addOption("tags", tag);
        });
        if (book.category) addOption("category", book.category);
        if (book.source) addOption("source", book.source);
      });

      // 3. 封面
      var coverIds = Object.keys(payload.covers || {});
      for (var i = 0; i < coverIds.length; i++) {
        status("正在恢复封面 " + (i + 1) + " / " + coverIds.length + "…");
        var item = payload.covers[coverIds[i]];
        var id = coverIds[i];
        // 书目里的 id 可能是数字，键名取回来是字符串，对齐一下
        var book = merged.filter(function (b) {
          return String(b.id) === String(id);
        })[0];
        try {
          await saveCover(book ? book.id : id, base64ToBlob(item.data, item.mime));
        } catch (e) {
          console.warn("封面写入失败", id, e);
        }
      }

      // 4. 附件
      var assets = payload.assets || [];
      for (var j = 0; j < assets.length; j++) {
        status("正在恢复附件 " + (j + 1) + " / " + assets.length + "…");
        try {
          await saveAsset({
            id: assets[j].id,
            bookId: assets[j].bookId,
            kind: assets[j].kind || "attachment",
            name: assets[j].name,
            mime: assets[j].mime,
            size: assets[j].size,
            blob: base64ToBlob(assets[j].data, assets[j].mime),
          });
        } catch (e) {
          console.warn("附件写入失败", assets[j].name, e);
        }
      }

      if (typeof window.refreshShelf === "function") window.refreshShelf();
      status(
        "导入完成：书架现在有 " +
          merged.length +
          " 本书" +
          (assets.length ? "，恢复附件 " + assets.length + " 个" : "")
      );
    } catch (e) {
      console.error(e);
      status("导入失败：" + e.message);
    }
  }

  window.exportBackup = exportBackup;
  window.pickBackupFile = pickBackupFile;
  window.importBackup = importBackup;
})();
