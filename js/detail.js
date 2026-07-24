/* =====================================================
   Reading OS
   Book Detail Controller

   book-detail.html logic
===================================================== */

let currentBook = null;

document.addEventListener("DOMContentLoaded", function () {
  loadBookDetail();
});

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

function renderBook() {
  setText("book-title", currentBook.title);
  setText("book-author", currentBook.author || "未知作者");
  setText("book-description", currentBook.description || "暂无简介");

  const cover = document.querySelector("#book-cover");
  if (cover) {
    if (currentBook.cover === "custom") {
      cover.src = "assets/default-cover.jpg";
      loadCoverForDetail(currentBook.id);
    } else {
      cover.src = currentBook.cover || "assets/default-cover.jpg";
    }
  }

  renderTags();
  renderMeta();
  setText("book-type", currentBook.type || "未知");
  setText("book-status", currentBook.status || "未读");
  renderProgress();
  renderStatistics();

  const favBtn = document.querySelector(".favorite-button");
  if (favBtn) {
    favBtn.innerText = currentBook.favorite ? "★" : "☆";
  }
}

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
  }
}

function renderTags() {
  const box = document.querySelector("#book-tags");
  if (!box) return;

  box.innerHTML = "";
  const tags = currentBook.tags || [];

  tags.forEach((tag) => {
    const span = document.createElement("span");
    span.className = "detail-tag";
    span.innerText = tag;
    box.appendChild(span);
  });
}

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

function renderStatistics() {
  setText("read-time", (currentBook.readTime || 0) + " 分钟");
  setText("read-count", currentBook.readCount || 0);
  setText("note-count", currentBook.notes ? currentBook.notes.length : 0);
}

function startReading() {
  if (!currentBook) return;

  sessionStorage.setItem("currentBook", JSON.stringify(currentBook));
  window.location.href = "reader.html";
}

function backShelf() {
  window.location.href = "index.html";
}

function toggleFavorite() {
  currentBook.favorite = !currentBook.favorite;

  sessionStorage.setItem("currentBook", JSON.stringify(currentBook));
  updateBook(currentBook);

  const btn = document.querySelector(".favorite-button");
  if (btn) {
    btn.innerText = currentBook.favorite ? "★" : "☆";
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = value;
  }
}

window.startReading = startReading;
window.backShelf = backShelf;
window.toggleFavorite = toggleFavorite;
