/* =====================================================
   Reading OS
   Bookshelf Controller

   index.html logic

   支持从 IndexedDB 加载自定义封面
===================================================== */



let books = [];





// ===============================
// 页面初始化
// ===============================


document.addEventListener(
  "DOMContentLoaded",
  function () {
    initApp();
  }
);





async function initApp() {
  books = getBooks();
  renderBooks();
  updateBookCount();
  initTheme();
}





// ===============================
// 渲染书架
// ===============================


function renderBooks() {
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
      // 如果希望图片加载完成后释放 URL（但释放后 src 会失效），所以不释放
      // 浏览器会在页面关闭时自动回收
    }
  } catch (e) {
    // 加载失败，保留默认封面
    console.warn(`封面加载失败 (${bookId}):`, e);
  }
}





// ===============================
// 打开书籍详情
// ===============================


function openBook(id) {
  const book = books.find(b => b.id === id);
  if (!book) return;

  sessionStorage.setItem(
    "currentBook",
    JSON.stringify(book)
  );

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
// 添加书籍入口
// ===============================


function openImport() {
  // 未来连接 import.js
  alert("导入功能开发中");
}





// ===============================
// 书籍数量
// ===============================


function updateBookCount() {
  const count = document.querySelector("#book-count");
  if (count) {
    count.innerText = books.length;
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
  }
}


function toggleTheme() {
  document.body.classList.toggle("dark");

  const dark = document.body.classList.contains("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
}





// ===============================
// 暴露函数到 window
// ===============================


window.openBook = openBook;
window.deleteBookItem = deleteBookItem;
window.searchBooks = searchBooks;
window.openImport = openImport;
window.toggleTheme = toggleTheme;