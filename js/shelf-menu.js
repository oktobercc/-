/* =====================================================
   页间集 · 书架卡片操作
   1) 卡片右上角 ··· 菜单：下载 / 分享 / 设为私密 / 批量选择 / 删除
   2) 多选模式：手机端长按任意一本进入，桌面端从 ··· 菜单进入
   3) 批量：删除 / 添加标签 / 移除标签 / 设置分类 / 分享 / 私密

   依赖 storage.js 的读写接口，渲染完卡片后由 app.js 调用 bindCardActions()
===================================================== */
(function () {
  "use strict";

  var selecting = false;
  var selected = new Set();
  var suppressClickUntil = 0;

  /* =====================================================
     一、通用小组件：浮层菜单 / 选择面板 / 提示条
  ===================================================== */

  var openPopup = null;

  function closePopup() {
    if (openPopup && openPopup.parentNode) openPopup.parentNode.removeChild(openPopup);
    openPopup = null;
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("touchstart", onOutside, true);
    window.removeEventListener("scroll", closePopup, true);
    window.removeEventListener("resize", closePopup);
  }

  function onOutside(e) {
    if (openPopup && !openPopup.contains(e.target)) closePopup();
  }

  /** 把菜单挂到 body 上定位，避免被卡片的 overflow:hidden 裁掉 */
  function showMenu(anchor, items) {
    closePopup();

    var menu = document.createElement("div");
    menu.className = "card-menu";

    items.forEach(function (item) {
      if (item.divider) {
        menu.appendChild(document.createElement("hr"));
        return;
      }
      var button = document.createElement("button");
      button.type = "button";
      button.className = "card-menu-item" + (item.danger ? " danger" : "");
      button.innerHTML = '<span class="mi-icon">' + item.icon + "</span>" + escapeHtml(item.label);
      button.onclick = function (e) {
        e.stopPropagation();
        closePopup();
        item.run();
      };
      menu.appendChild(button);
    });

    document.body.appendChild(menu);

    // 默认贴在按钮右下，空间不够就翻到另一侧
    var rect = anchor.getBoundingClientRect();
    var width = menu.offsetWidth;
    var height = menu.offsetHeight;
    var left = Math.min(rect.right - width, window.innerWidth - width - 8);
    var top = rect.bottom + 6;

    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = top + "px";

    openPopup = menu;
    setTimeout(function () {
      document.addEventListener("mousedown", onOutside, true);
      document.addEventListener("touchstart", onOutside, true);
      window.addEventListener("scroll", closePopup, true);
      window.addEventListener("resize", closePopup);
    }, 0);
  }

  /** 选项面板：选已有的，或现场新建一个 */
  function showPicker(config) {
    closePopup();

    var mask = document.createElement("div");
    mask.className = "sheet-mask";

    var options = (config.options || []).filter(Boolean);
    var chips = options
      .map(function (value) {
        return '<button type="button" class="sheet-chip" data-value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</button>";
      })
      .join("");

    mask.innerHTML =
      '<div class="sheet">' +
      '<h4 class="sheet-title">' + escapeHtml(config.title || "") + "</h4>" +
      (config.hint ? '<p class="sheet-hint">' + escapeHtml(config.hint) + "</p>" : "") +
      '<div class="sheet-chips">' + (chips || '<p class="sheet-hint">没有可选项</p>') + "</div>" +
      (config.allowNew
        ? '<div class="sheet-new"><input type="text" class="sheet-input" placeholder="新建…" /><button type="button" class="sheet-add">添加</button></div>'
        : "") +
      '<div class="sheet-foot"><button type="button" class="sheet-cancel">取消</button></div>' +
      "</div>";

    function done(value) {
      value = (value || "").trim();
      if (!value) return;
      mask.remove();
      config.onPick(value);
    }

    mask.querySelectorAll(".sheet-chip").forEach(function (chip) {
      chip.onclick = function () {
        done(chip.getAttribute("data-value"));
      };
    });

    var input = mask.querySelector(".sheet-input");
    if (input) {
      mask.querySelector(".sheet-add").onclick = function () {
        done(input.value);
      };
      input.onkeydown = function (e) {
        if (e.key === "Enter") done(input.value);
      };
    }

    mask.querySelector(".sheet-cancel").onclick = function () {
      mask.remove();
    };
    mask.onclick = function (e) {
      if (e.target === mask) mask.remove();
    };

    document.body.appendChild(mask);
    if (input) input.focus();
  }

  function toast(text) {
    var box = document.createElement("div");
    box.className = "shelf-toast";
    box.textContent = text;
    document.body.appendChild(box);
    setTimeout(function () {
      box.classList.add("out");
      setTimeout(function () {
        box.remove();
      }, 300);
    }, 2000);
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* =====================================================
     二、单本操作：下载 / 分享 / 私密 / 删除
  ===================================================== */

  function password() {
    return window.DOWNLOAD_PASSWORD || "0025";
  }

  function attachmentsOf(book) {
    return (book.attachments || []).filter(function (a) {
      return a.kind === "file" && a.assetId;
    });
  }

  async function downloadBook(book, anchor) {
    var files = attachmentsOf(book);

    // 没有附件时，回头找一下老版本存的整本书文件
    if (!files.length) {
      try {
        var row = await getFile(book.id);
        if (row && row.file) {
          saveBlob(row.file, row.file.name || book.title);
          return;
        }
      } catch (e) {
        /* 忽略 */
      }
      toast("这本书没有可下载的文件");
      return;
    }

    if (files.length === 1) {
      pullAsset(files[0]);
      return;
    }

    // 多个附件：再弹一层让用户挑
    showMenu(
      anchor,
      files.map(function (item) {
        return {
          icon: "⤓",
          label: item.name + (item.size ? "（" + formatSize(item.size) + "）" : ""),
          run: function () {
            pullAsset(item);
          },
        };
      })
    );
  }

  async function pullAsset(item) {
    var input = prompt("下载需要密码");
    if (input === null) return;
    if (input.trim() !== password()) {
      toast("密码不对");
      return;
    }

    try {
      var asset = await getAsset(item.assetId);
      if (!asset || !asset.blob) {
        toast("文件已丢失");
        return;
      }
      saveBlob(asset.blob, item.name || "download");
    } catch (e) {
      toast("下载失败：" + e.message);
    }
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 3000);
  }

  function shareText(list) {
    return list
      .map(function (book) {
        var line = "《" + (book.title || "未命名") + "》";
        if (book.author) line += " — " + book.author;
        if (book.publisher) line += "（" + book.publisher + "）";
        if (book.url) line += "\n" + book.url;
        return line;
      })
      .join("\n\n");
  }

  async function shareBooks(list) {
    if (!list.length) return;
    var text = shareText(list);
    var title = list.length === 1 ? list[0].title : "分享 " + list.length + " 本书";

    if (navigator.share) {
      try {
        await navigator.share({ title: title, text: text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // 用户自己取消的
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板");
    } catch (e) {
      // file:// 下剪贴板通常不可用，退回给用户自己复制
      window.prompt("复制下面的内容分享出去：", text);
    }
  }

  function setPrivate(list, value) {
    var all = getBooks();
    list.forEach(function (target) {
      var book = all.filter(function (b) {
        return String(b.id) === String(target.id);
      })[0];
      if (book) book.private = value;
    });
    saveBooks(all);
    refresh();
    toast(value ? "已设为私密，打开时需要密码" : "已取消私密");
  }

  async function removeBooks(list) {
    var name = list.length === 1 ? "《" + (list[0].title || "") + "》" : "选中的 " + list.length + " 本书";
    if (!confirm("删除" + name + "？此操作不可撤销")) return;

    for (var i = 0; i < list.length; i++) {
      try {
        await deleteBook(list[i].id);
      } catch (e) {
        console.warn("删除失败", list[i].id, e);
      }
    }
    exitSelect();
    refresh();
    toast("已删除 " + list.length + " 本");
  }

  /* =====================================================
     三、批量：标签 / 分类
  ===================================================== */

  function addTagTo(list) {
    showPicker({
      title: "添加标签",
      hint: "会加到选中的 " + list.length + " 本书上",
      options: getOptions().tags,
      allowNew: true,
      onPick: function (tag) {
        addOption("tags", tag);
        updateEach(list, function (book) {
          if (!book.tags) book.tags = [];
          if (book.tags.indexOf(tag) < 0) book.tags.push(tag);
        });
        toast("已添加标签「" + tag + "」");
      },
    });
  }

  function removeTagFrom(list) {
    var present = [];
    list.forEach(function (book) {
      (book.tags || []).forEach(function (tag) {
        if (present.indexOf(tag) < 0) present.push(tag);
      });
    });

    if (!present.length) {
      toast("选中的书还没有标签");
      return;
    }

    showPicker({
      title: "移除标签",
      hint: "从选中的书上去掉这个标签",
      options: present,
      allowNew: false,
      onPick: function (tag) {
        updateEach(list, function (book) {
          book.tags = (book.tags || []).filter(function (t) {
            return t !== tag;
          });
        });
        toast("已移除标签「" + tag + "」");
      },
    });
  }

  function setCategoryFor(list) {
    showPicker({
      title: "设置分类",
      hint: "选中的 " + list.length + " 本书会改成同一个分类",
      options: getOptions().category,
      allowNew: true,
      onPick: function (value) {
        addOption("category", value);
        updateEach(list, function (book) {
          book.category = value;
        });
        toast("分类已改为「" + value + "」");
      },
    });
  }

  /** 按 id 批量改写并落盘 */
  function updateEach(list, mutate) {
    var ids = list.map(function (b) {
      return String(b.id);
    });
    var all = getBooks();
    all.forEach(function (book) {
      if (ids.indexOf(String(book.id)) >= 0) mutate(book);
    });
    saveBooks(all);
    refresh();
  }

  function refresh() {
    if (typeof window.refreshShelf === "function") window.refreshShelf();
  }

  /* =====================================================
     四、多选模式
  ===================================================== */

  function enterSelect(id) {
    selecting = true;
    if (id != null) selected.add(String(id));
    document.getElementById("bookshelf").classList.add("selecting");
    syncCards();
    updateBar();
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function exitSelect() {
    selecting = false;
    selected.clear();
    var shelf = document.getElementById("bookshelf");
    if (shelf) shelf.classList.remove("selecting");
    syncCards();
    updateBar();
  }

  function toggle(id) {
    id = String(id);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);

    if (!selected.size) {
      exitSelect();
      return;
    }
    syncCards();
    updateBar();
  }

  function selectAll() {
    var visible = visibleBooks();
    var allChosen = visible.every(function (book) {
      return selected.has(String(book.id));
    });

    if (allChosen) {
      exitSelect();
      return;
    }
    visible.forEach(function (book) {
      selected.add(String(book.id));
    });
    syncCards();
    updateBar();
  }

  /** 搜索过滤后仍然显示在架上的书 */
  function visibleBooks() {
    return getBooks().filter(function (book) {
      var card = document.querySelector('.book-card[data-id="' + book.id + '"]');
      return card && !card.classList.contains("hidden");
    });
  }

  function chosenBooks() {
    return getBooks().filter(function (book) {
      return selected.has(String(book.id));
    });
  }

  function syncCards() {
    document.querySelectorAll(".book-card").forEach(function (card) {
      card.classList.toggle("checked", selected.has(String(card.getAttribute("data-id"))));
    });
  }

  function updateBar() {
    var bar = document.getElementById("batch-bar");
    if (!bar) return;

    bar.classList.toggle("hidden", !selecting);
    document.body.classList.toggle("batch-open", selecting);

    var count = document.getElementById("batch-count");
    if (count) count.textContent = selected.size;
  }

  function initBar() {
    var bar = document.getElementById("batch-bar");
    if (!bar) return;

    bar.addEventListener("click", function (e) {
      var button = e.target.closest("[data-action]");
      if (!button) return;

      var list = chosenBooks();
      var action = button.getAttribute("data-action");

      if (action === "cancel") return exitSelect();
      if (action === "all") return selectAll();

      if (!list.length) {
        toast("先选中至少一本书");
        return;
      }

      switch (action) {
        case "delete": removeBooks(list); break;
        case "tag-add": addTagTo(list); break;
        case "tag-remove": removeTagFrom(list); break;
        case "category": setCategoryFor(list); break;
        case "share": shareBooks(list); break;
        case "private": setPrivate(list, !list.every(function (b) { return b.private; })); break;
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closePopup();
        if (selecting) exitSelect();
      }
    });
  }

  /* =====================================================
     五、绑定到卡片
  ===================================================== */

  function bindCardActions(card, book) {
    card.setAttribute("data-id", book.id);

    var menuBtn = card.querySelector(".card-menu-btn");
    if (menuBtn) {
      menuBtn.onclick = function (e) {
        e.stopPropagation();
        e.preventDefault();
        openCardMenu(book, menuBtn);
      };
    }

    bindLongPress(card, book);
  }

  function openCardMenu(book, anchor) {
    showMenu(anchor, [
      { icon: "⤓", label: "下载", run: function () { downloadBook(book, anchor); } },
      { icon: "↗", label: "分享", run: function () { shareBooks([book]); } },
      {
        icon: book.private ? "🔓" : "🔒",
        label: book.private ? "取消私密" : "设为私密",
        run: function () { setPrivate([book], !book.private); },
      },
      { icon: "☑", label: "批量选择", run: function () { enterSelect(book.id); } },
      { divider: true },
      { icon: "🗑", label: "删除", danger: true, run: function () { removeBooks([book]); } },
    ]);
  }

  /** 手机端长按进多选 */
  function bindLongPress(card, book) {
    var timer = null;
    var moved = false;

    function cancel() {
      clearTimeout(timer);
      timer = null;
    }

    card.addEventListener(
      "touchstart",
      function () {
        moved = false;
        cancel();
        timer = setTimeout(function () {
          if (moved) return;
          suppressClickUntil = Date.now() + 700; // 别让长按后的那一下 click 打开书
          if (!selecting) enterSelect(book.id);
          else toggle(book.id);
        }, 480);
      },
      { passive: true }
    );

    card.addEventListener("touchmove", function () { moved = true; cancel(); }, { passive: true });
    card.addEventListener("touchend", cancel);
    card.addEventListener("touchcancel", cancel);

    // 长按选中后不要再弹系统菜单
    card.addEventListener("contextmenu", function (e) {
      if (selecting || Date.now() < suppressClickUntil) e.preventDefault();
    });
  }

  /* =====================================================
     六、私密书的开门口令
  ===================================================== */

  function allowOpen(book) {
    if (!book || !book.private) return true;
    var input = prompt("《" + (book.title || "") + "》是私密书籍，输入密码打开");
    if (input === null) return false;
    if (input.trim() === password()) return true;
    toast("密码不对");
    return false;
  }

  /* =====================================================
     对外接口
  ===================================================== */

  window.ShelfActions = {
    bindCardActions: bindCardActions,
    isSelecting: function () { return selecting; },
    isChosen: function (id) { return selected.has(String(id)); },
    toggle: toggle,
    enterSelect: enterSelect,
    exitSelect: exitSelect,
    clickSuppressed: function () { return Date.now() < suppressClickUntil; },
    syncAfterRender: function () {
      var shelf = document.getElementById("bookshelf");
      if (shelf) shelf.classList.toggle("selecting", selecting);
      syncCards();
      updateBar();
    },
    allowOpen: allowOpen,
    toast: toast,
  };

  document.addEventListener("DOMContentLoaded", initBar);
})();
