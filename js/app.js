/* =====================================================
   Reading OS
   App Controller

   index.html logic

   支持：
   - 书架渲染 / 搜索 / 删除 / 主题切换（原有功能）
   - 侧边栏视图切换（书库 / 统计 / 书评 / 关于我）（新增）
   - 统计子菜单与 Tab 联动（新增）
   - 从 IndexedDB 加载自定义封面
===================================================== */

let books = [];

// ===============================
// 页面初始化
// ===============================

document.addEventListener("DOMContentLoaded", function () {
  initApp();
});

async function initApp() {
  books = getBooks();
  renderBooks();
  updateBookCount();
  initTheme();
  initNavigation();
}

// ===============================
// 渲染书架
// ===============================

function renderBooks() {
  // 注意：书架容器的 class/id 都是 "bookshelf"
  const container = document.querySelector("#bookshelf");
  if (!container) return;

  container.innerHTML = "";

  if (books.length === 0) {
    container.innerHTML = `
      <div class="empty-books">
        <h3>书架还是空的</h3>
        <p>添加一本书开始阅读吧</p>
      </div>
    `;
    return;
  }

  books.forEach((book) => {
    const card = createBookCard(book);
    container.appendChild(card);

    // 如果封面标记为自定义，异步加载
    if (book.cover === "custom") {
      loadCoverForCard(card, book.id);
    }
  });
}

// ===============================
// 创建书籍卡片
// ===============================

function createBookCard(book) {
  const div = document.createElement("div");
  div.className = "book-card";

  div.onclick = function (e) {
    // 点击删除按钮不跳转
    if (e.target.classList.contains("delete-book")) {
      return;
    }
    openBook(book.id);
  };

  // 封面图片的 src 先使用默认或已有的 URL
  let coverSrc = book.cover || "assets/default-cover.jpg";
  // 如果是自定义封面，暂时显示默认占位，等待异步加载
  if (book.cover === "custom") {
    coverSrc = "assets/default-cover.jpg";
  }

  div.innerHTML = `
    <div class="book-cover-wrapper">
      <img
        class="book-cover"
        src="${coverSrc}"
        alt="${book.title || "未命名"}的封面"
      >
    </div>

    <div class="book-info">
      <div class="book-title">${book.title || "未命名"}</div>
      <div class="book-author">${book.author || "未知作者"}</div>
      <span class="book-status ${getStatusClass(book.status)}">
        ${book.status || "未读"}
      </span>

      <div class="progress-box">
        <div class="progress-text">
          <span>阅读进度</span>
          <span>${book.progress || 0}%</span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-value"
            style="width:${book.progress || 0}%"
          ></div>
        </div>
      </div>

      <button
        class="delete-book"
        onclick="deleteBookItem(event, ${book.id})"
      >
        删除
      </button>
    </div>
  `;

  return div;
}

// ===============================
// 异步加载封面
// ===============================

async function loadCoverForCard(card, bookId) {
  const img = card.querySelector(".book-cover");
  if (!img) return;

  try {
    const blob = await getCover(bookId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      img.src = url;
      // 浏览器会在页面关闭时自动回收，此处不主动 revoke
    }
  } catch (e) {
    console.warn(`封面加载失败 (${bookId}):`, e);
  }
}

// ===============================
// 打开书籍详情
// ===============================

function openBook(id) {
  const book = books.find((b) => b.id === id);
  if (!book) return;

  sessionStorage.setItem("currentBook", JSON.stringify(book));
  window.location.href = "book-detail.html";
}

// ===============================
// 删除书籍
// ===============================

async function deleteBookItem(event, id) {
  event.stopPropagation();

  const confirmDelete = confirm("确定删除这本书吗？");
  if (!confirmDelete) return;

  await deleteBook(id);

  books = getBooks();
  renderBooks();
  updateBookCount();
}

// ===============================
// 搜索
// ===============================

function searchBooks(keyword) {
  keyword = keyword.toLowerCase().trim();

  const cards = document.querySelectorAll(".book-card");

  books.forEach((book, index) => {
    const card = cards[index];
    if (!card) return;

    const text = (book.title + book.author).toLowerCase();

    if (keyword === "" || text.includes(keyword)) {
      card.classList.remove("hidden");
    } else {
      card.classList.add("hidden");
    }
  });
}

// ===============================
// 书籍数量（顶部计数 + 侧边栏角标）
// ===============================

function updateBookCount() {
  const count = document.querySelector("#book-count");
  if (count) {
    count.innerText = books.length;
  }

  const badge = document.querySelector("#nav-badge");
  if (badge) {
    badge.innerText = books.length;
  }
}

// ===============================
// 状态样式
// ===============================

function getStatusClass(status) {
  switch (status) {
    case "在读":
      return "status-reading";
    case "已读":
      return "status-read";
    case "暂停":
      return "status-paused";
    case "放弃":
      return "status-abandoned";
    default:
      return "status-unread";
  }
}

// ===============================
// 主题
// ===============================

function initTheme() {
  const theme = localStorage.getItem("theme");
  if (theme === "dark") {
    document.body.classList.add("dark");
    updateThemeIcon(true);
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");

  const dark = document.body.classList.contains("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
  updateThemeIcon(dark);
}

function updateThemeIcon(isDark) {
  const icon = document.querySelector("#theme-icon");
  if (icon) {
    icon.innerText = isDark ? "☀" : "☪";
  }
}

// ===============================
// 侧边栏导航 / 视图切换（新增）
// ===============================

function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item[data-view]");

  navItems.forEach((item) => {
    item.addEventListener("click", function (e) {
      const view = item.getAttribute("data-view");

      // 有子菜单的项（统计）单独处理：展开/收起子菜单
      if (item.classList.contains("has-sub")) {
        // 点击的是子菜单里的项则不在这里处理（会冒泡到 sub-item 监听器）
        if (e.target.closest(".sub-item")) return;

        toggleSubMenu(item);
      }

      switchView(view);
    });
  });

  // 统计子菜单里的项（画册/热力图/日历等）
  const subItems = document.querySelectorAll(".sub-item[data-subview]");
  subItems.forEach((sub) => {
    sub.addEventListener("click", function (e) {
      e.stopPropagation();
      const subview = sub.getAttribute("data-subview");
      switchView("stats");
      switchStatsSubview(subview);
    });
  });

  // 统计视图内部的 Tab 按钮
  const statsTabs = document.querySelectorAll(".stats-tab[data-subview]");
  statsTabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      const subview = tab.getAttribute("data-subview");
      switchStatsSubview(subview);
    });
  });
}

function toggleSubMenu(item) {
  const subMenu = item.querySelector(".sub-menu");
  if (!subMenu) return;

  item.classList.toggle("open");
  subMenu.classList.toggle("show");
}

// 切换主视图（书库 / 统计 / 书评 / 关于我）
function switchView(view) {
  if (!view) return;

  // 切换侧边栏高亮
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-view") === view);
  });

  // 切换视图面板显隐
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const isTarget = panel.id === "view-" + view;
    panel.classList.toggle("hidden", !isTarget);
  });

  // 进入统计视图时，若还未渲染画册则渲染一次
  if (view === "stats") {
    renderGalleryIfNeeded();
    renderStatsSummary();
  }
}

// 切换统计视图下的子视图（仪表盘 / 画册 / 热力图 / 日历）
function switchStatsSubview(subview) {
  if (!subview) return;

  document.querySelectorAll(".stats-tab[data-subview]").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-subview") === subview);
  });

  document.querySelectorAll(".stats-subview").forEach((panel) => {
    const isTarget = panel.id === "subview-" + subview;
    panel.classList.toggle("hidden", !isTarget);
  });

  if (subview === "gallery") {
    renderGalleryIfNeeded();
  }
}

// ===============================
// 统计仪表盘数据（新增：填充原本一直是 0 的统计数字）
// ===============================

function renderStatsSummary() {
  const totalBooks = document.querySelector("#stat-total-books");
  const totalTime = document.querySelector("#stat-total-time");
  const reading = document.querySelector("#stat-reading");
  const finished = document.querySelector("#stat-finished");

  if (totalBooks) totalBooks.innerText = books.length;

  if (totalTime) {
    const minutes = books.reduce((sum, b) => sum + (b.readTime || 0), 0);
    totalTime.innerText = minutes + " 分钟";
  }

  if (reading) {
    reading.innerText = books.filter((b) => b.status === "在读").length;
  }

  if (finished) {
    finished.innerText = books.filter((b) => b.status === "已读").length;
  }
}

// ===============================
// 画册（封面墙）渲染
// ===============================

let galleryRendered = false;

async function renderGalleryIfNeeded() {
  if (galleryRendered) return;

  const grid = document.querySelector("#gallery-grid");
  if (!grid) return;

  grid.innerHTML = "";

  if (books.length === 0) {
    grid.innerHTML = `<div class="empty-state"><h3>暂无封面</h3></div>`;
    return;
  }

  for (const book of books) {
    const img = document.createElement("img");
    img.alt = book.title || "未命名";
    img.src = "assets/default-cover.jpg";
    grid.appendChild(img);

    if (book.cover === "custom") {
      try {
        const blob = await getCover(book.id);
        if (blob) {
          img.src = URL.createObjectURL(blob);
        }
      } catch (e) {
        console.warn(`封面加载失败 (${book.id}):`, e);
      }
    } else if (book.cover) {
      img.src = book.cover;
    }
  }

  galleryRendered = true;
}

// ===============================
// 暴露函数到 window
// ===============================

window.openBook = openBook;
window.deleteBookItem = deleteBookItem;
window.searchBooks = searchBooks;
window.toggleTheme = toggleTheme;
window.switchView = switchView;
window.switchStatsSubview = switchStatsSubview;
