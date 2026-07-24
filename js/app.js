/* =====================================================
   页间集 · 书架
   index.html logic
===================================================== */

let books = [];

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  books = getBooks();
  renderBooks();
  updateBookCount();
  initTheme();
  initNavigation();
}

/* ===============================
   书架
================================ */
function renderBooks() {
  const container = document.querySelector("#bookshelf");
  if (!container) return;

  container.innerHTML = "";

  if (books.length === 0) {
    container.innerHTML = `
      <div class="empty-books">
        <h3>书架还是空的</h3>
        <p>点右上角「添加书籍」，填完信息就会出现在这里</p>
      </div>
    `;
    return;
  }

  books.forEach((book) => {
    const card = createBookCard(book);
    container.appendChild(card);
    if (book.cover === "custom") loadCoverForCard(card, book.id);
  });
}

function createBookCard(book) {
  const div = document.createElement("div");
  div.className = "book-card";

  div.onclick = function (e) {
    if (e.target.classList.contains("delete-book")) return;
    openBook(book.id);
  };

  let coverSrc = book.cover && book.cover !== "custom" ? book.cover : "assets/default-cover.jpg";

  div.innerHTML = `
    <div class="book-cover-wrapper">
      <img class="book-cover" src="${coverSrc}" alt="${escapeAttr(book.title || "未命名")}的封面">
    </div>

    <div class="book-info">
      <div class="book-title">${escapeAttr(book.title || "未命名")}</div>
      <div class="book-author">${escapeAttr(book.author || "未知作者")}</div>
      <span class="book-status ${getStatusClass(book.status)}">${escapeAttr(book.status || "未读")}</span>

      <div class="progress-box">
        <div class="progress-text">
          <span>阅读进度</span>
          <span>${book.progress || 0}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-value" style="width:${book.progress || 0}%"></div>
        </div>
      </div>

      <button class="delete-book">删除</button>
    </div>
  `;

  div.querySelector(".delete-book").onclick = (e) => deleteBookItem(e, book.id);
  return div;
}

async function loadCoverForCard(card, bookId) {
  const img = card.querySelector(".book-cover");
  if (!img) return;

  try {
    const blob = await getCover(bookId);
    if (blob) img.src = URL.createObjectURL(blob);
  } catch (e) {
    console.warn("封面加载失败", e);
  }
}

/* ===============================
   打开 / 新建 / 删除
================================ */
function openBook(id) {
  location.href = "book-detail.html?id=" + encodeURIComponent(id);
}

function addBookPage() {
  location.href = "add-book.html";
}

async function deleteBookItem(event, id) {
  event.stopPropagation();
  const book = books.find((b) => String(b.id) === String(id));
  if (!confirm(`删除《${book ? book.title : ""}》？`)) return;

  try {
    await deleteBook(id);
  } catch (e) {
    alert("删除时出了问题：" + e.message);
  }

  books = getBooks();
  renderBooks();
  updateBookCount();
}

/* ===============================
   搜索
================================ */
function searchBooks(keyword) {
  keyword = keyword.toLowerCase().trim();
  const cards = document.querySelectorAll(".book-card");

  books.forEach((book, index) => {
    const card = cards[index];
    if (!card) return;

    const text = [book.title, book.author, book.source, book.category, (book.tags || []).join("")]
      .join("")
      .toLowerCase();

    card.classList.toggle("hidden", !(keyword === "" || text.includes(keyword)));
  });
}

function updateBookCount() {
  const count = document.querySelector("#book-count");
  if (count) count.innerText = books.length;

  const badge = document.querySelector("#nav-badge");
  if (badge) badge.innerText = books.length;
}

function getStatusClass(status) {
  switch (status) {
    case "在读": return "status-reading";
    case "已读": return "status-read";
    case "暂停": return "status-paused";
    case "弃读": return "status-abandoned";
    default: return "status-unread";
  }
}

/* ===============================
   主题
================================ */
function initTheme() {
  if (localStorage.getItem("theme") === "dark") {
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
  if (icon) icon.innerText = isDark ? "☀" : "☪";
}

/* ===============================
   导航
================================ */
function initNavigation() {
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", function (e) {
      if (e.target.closest(".sub-item")) return;
      switchView(item.getAttribute("data-view"));
    });
  });

  document.querySelectorAll(".stats-tab[data-subview]").forEach((tab) => {
    tab.addEventListener("click", () => switchStatsSubview(tab.getAttribute("data-subview")));
  });
}

function switchView(view) {
  if (!view) return;

  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-view") === view);
  });

  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== "view-" + view);
  });

  if (view === "stats") {
    renderStatsSummary();
    renderGallery();
  }
  if (view === "reviews") renderReviews();
}

function switchStatsSubview(subview) {
  if (!subview) return;

  document.querySelectorAll(".stats-tab[data-subview]").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-subview") === subview);
  });

  document.querySelectorAll(".stats-subview").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== "subview-" + subview);
  });

  if (subview === "gallery") renderGallery();
}

/* ===============================
   统计
================================ */
function renderStatsSummary() {
  setNumber("#stat-total-books", books.length);

  const seconds = books.reduce((sum, b) => sum + (b.readSeconds || (b.readTime || 0) * 60), 0);
  setNumber("#stat-total-time", formatDuration(seconds));

  setNumber("#stat-reading", books.filter((b) => b.status === "在读").length);
  setNumber("#stat-finished", books.filter((b) => b.status === "已读").length);
}

function setNumber(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.innerText = value;
}

async function renderGallery() {
  const grid = document.querySelector("#gallery-grid");
  if (!grid) return;

  grid.innerHTML = "";
  if (books.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>暂无封面</h3></div>';
    return;
  }

  for (const book of books) {
    const img = document.createElement("img");
    img.alt = book.title || "未命名";
    img.src = book.cover && book.cover !== "custom" ? book.cover : "assets/default-cover.jpg";
    img.style.cursor = "pointer";
    img.onclick = () => openBook(book.id);
    grid.appendChild(img);

    if (book.cover === "custom") {
      try {
        const blob = await getCover(book.id);
        if (blob) img.src = URL.createObjectURL(blob);
      } catch (e) {
        console.warn(e);
      }
    }
  }
}

function renderReviews() {
  const panel = document.querySelector("#view-reviews .review-list");
  if (!panel) return;

  const written = books.filter((b) => b.review && b.review.trim());
  const empty = document.querySelector("#view-reviews .empty-state-large");

  if (written.length === 0) {
    panel.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  panel.innerHTML = written
    .map(
      (book) => `
      <article class="review-item" data-id="${book.id}">
        <h4>${escapeAttr(book.title)}</h4>
        <p class="review-author">${escapeAttr(book.author || "未知作者")}</p>
        <p class="review-text">${escapeAttr(book.review).slice(0, 200)}</p>
      </article>`
    )
    .join("");

  panel.querySelectorAll(".review-item").forEach((item) => {
    item.onclick = () => openBook(item.getAttribute("data-id"));
  });
}

function escapeAttr(text) {
  return String(text || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

window.openBook = openBook;
window.addBookPage = addBookPage;
window.deleteBookItem = deleteBookItem;
window.searchBooks = searchBooks;
window.toggleTheme = toggleTheme;
window.switchView = switchView;
window.switchStatsSubview = switchStatsSubview;
