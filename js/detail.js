/* =====================================================
   Reading OS
   Book Detail Controller

   book-detail.html logic

   支持从 IndexedDB 加载自定义封面
===================================================== */



let currentBook = null;





// ===============================
// 页面初始化
// ===============================


document.addEventListener(
  "DOMContentLoaded",
  function () {
    loadBookDetail();
  }
);





// ===============================
// 加载书籍信息
// ===============================


function loadBookDetail() {
  const data = sessionStorage.getItem("currentBook");
  if (!data) {
    alert("未找到书籍信息");
    window.location.href = "index.html";
    return;
  }

  currentBook = JSON.parse(data);
  renderBook();
}





// ===============================
// 渲染详情页面
// ===============================


function renderBook() {
  // 书名
  setText("book-title", currentBook.title);

  // 作者
  setText("book-author", currentBook.author || "未知作者");

  // 简介
  setText(
    "book-description",
    currentBook.description || "暂无简介"
  );

  // 封面
  const cover = document.querySelector("#book-cover");
  if (cover) {
    if (currentBook.cover === "custom") {
      // 先显示默认占位，异步加载真实封面
      cover.src = "assets/default-cover.jpg";
      loadCoverForDetail(currentBook.id);
    } else {
      cover.src = currentBook.cover || "assets/default-cover.jpg";
    }
  }

  // 标签
  renderTags();

  // 基础信息
  renderMeta();
  setText("book-type", currentBook.type || "未知");
  setText("book-status", currentBook.status || "未读");

  // 阅读进度
  renderProgress();

  // 阅读统计
  renderStatistics();

  // 收藏按钮状态
  const favBtn = document.querySelector(".favorite-button");
  if (favBtn) {
    favBtn.innerText = currentBook.favorite ? "★" : "☆";
  }
}





// ===============================
// 异步加载封面
// ===============================


async function loadCoverForDetail(bookId) {
  const cover = document.querySelector("#book-cover");
  if (!cover) return;

  try {
    const blob = await getCover(bookId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      cover.src = url;
    }
  } catch (e) {
    console.warn(`封面加载失败 (${bookId}):`, e);
    // 加载失败则保留默认封面
  }
}





// ===============================
// 标签
// ===============================


function renderTags() {
  const box = document.querySelector("#book-tags");
  if (!box) return;

  box.innerHTML = "";
  const tags = currentBook.tags || [];

  tags.forEach(tag => {
    const span = document.createElement("span");
    span.className = "detail-tag";
    span.innerText = tag;
    box.appendChild(span);
  });
}





// ===============================
// 基础信息
// ===============================


function renderMeta() {
  const publisher = document.querySelector("#book-publisher");
  if (publisher) {
    publisher.innerText = currentBook.publisher || "未知";
  }

  const year = document.querySelector("#book-year");
  if (year) {
    year.innerText = currentBook.year || "未知";
  }
}





// ===============================
// 阅读进度
// ===============================


function renderProgress() {
  const progress = currentBook.progress || 0;

  const text = document.querySelector("#book-progress");
  if (text) {
    text.innerText = progress + "%";
  }

  const bar = document.querySelector("#progress-value");
  if (bar) {
    bar.style.width = progress + "%";
  }
}





// ===============================
// 阅读统计
// ===============================


function renderStatistics() {
  setText(
    "read-time",
    (currentBook.readTime || 0) + " 分钟"
  );

  setText(
    "read-count",
    currentBook.readCount || 0
  );

  setText(
    "note-count",
    currentBook.notes ? currentBook.notes.length : 0
  );
}





// ===============================
// 开始阅读
// ===============================


function startReading() {
  if (!currentBook) return;

  sessionStorage.setItem(
    "currentBook",
    JSON.stringify(currentBook)
  );

  window.location.href = "reader.html";
}





// ===============================
// 返回书架
// ===============================


function backShelf() {
  window.location.href = "index.html";
}





// ===============================
// 收藏
// ===============================


function toggleFavorite() {
  currentBook.favorite = !currentBook.favorite;

  // 更新 sessionStorage
  sessionStorage.setItem(
    "currentBook",
    JSON.stringify(currentBook)
  );

  // 更新本地存储中的书籍数据
  updateBook(currentBook);

  // 更新按钮文字
  const btn = document.querySelector(".favorite-button");
  if (btn) {
    btn.innerText = currentBook.favorite ? "★" : "☆";
  }
}





// ===============================
// 工具函数
// ===============================


function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = value;
  }
}





// ===============================
// 暴露函数到 window
// ===============================


window.startReading = startReading;
window.backShelf = backShelf;
window.toggleFavorite = toggleFavorite;