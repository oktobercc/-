/* =====================================================
   页间集 · 书籍详情
   book-detail.html?id=123
===================================================== */

const DOWNLOAD_PASSWORD = "0025";

let currentBook = null;
let timerRunning = false;
let timerStart = null;
let timerTick = null;

/* ===============================
   初始化
================================ */
document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(location.search);
  let id = params.get("id");

  // 兼容旧的 sessionStorage 跳转方式
  if (!id) {
    const cached = sessionStorage.getItem("currentBook");
    if (cached) {
      try {
        id = JSON.parse(cached).id;
      } catch (e) {}
    }
  }

  currentBook = id ? getBookById(id) : null;

  if (!currentBook) {
    alert("找不到这本书，回到书架");
    location.href = "index.html";
    return;
  }

  render();
});

window.addEventListener("beforeunload", function () {
  if (timerRunning) stopTimer(true);
});

/* ===============================
   渲染
================================ */
function render() {
  document.title = "页间集 · " + (currentBook.title || "书籍详情");

  setText("book-title", currentBook.title || "未命名");
  setText("book-author", currentBook.author || "未知作者");
  setText("book-status", currentBook.status || "未读");

  const badge = document.getElementById("book-status");
  badge.className = "status-badge " + statusClass(currentBook.status);

  renderCover();
  renderRating();
  renderMeta();
  renderTags();
  renderParagraphs("book-description", currentBook.description, "暂无简介");
  renderAttachments();
  renderReview();
  renderExcerpts();
  renderTimer();
  renderProgress();
  renderSessions();
}

async function renderCover() {
  const img = document.getElementById("book-cover");
  if (currentBook.cover === "custom") {
    try {
      const blob = await getCover(currentBook.id);
      if (blob) img.src = URL.createObjectURL(blob);
    } catch (e) {
      console.warn(e);
    }
  } else if (currentBook.cover) {
    img.src = currentBook.cover;
  }
}

function statusClass(status) {
  switch (status) {
    case "在读": return "status-reading";
    case "已读": return "status-read";
    case "暂停": return "status-paused";
    case "弃读": return "status-abandoned";
    default: return "status-unread";
  }
}

function renderRating() {
  if (currentBook.status !== "已读" || !currentBook.rating) return;

  document.getElementById("rating-line").classList.remove("hidden");
  const box = document.getElementById("hearts");
  box.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const percent = Math.max(0, Math.min(1, currentBook.rating - i)) * 100;
    const heart = document.createElement("span");
    heart.className = "heart";
    heart.innerHTML =
      '<span class="heart-bg">♥</span>' +
      '<span class="heart-fill" style="width:' + percent + '%"><span>♥</span></span>';
    box.appendChild(heart);
  }

  const value = currentBook.rating.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  setText("rating-text", value + " / 5");
}

function renderMeta() {
  const box = document.getElementById("detail-meta");
  const rows = [
    ["来源", currentBook.source],
    ["作品类型", currentBook.category],
    ["出版社", currentBook.publisher],
    ["字数", currentBook.words ? Number(currentBook.words).toLocaleString() + " 字" : ""],
    ["开始日期", currentBook.startDate],
    ["结束日期", currentBook.endDate],
    ["加入书架", currentBook.createTime],
  ].filter((row) => row[1]);

  box.innerHTML = rows
    .map(
      (row) =>
        `<div class="meta-item"><span class="meta-label">${row[0]}</span><span class="meta-value">${escapeHtml(row[1])}</span></div>`
    )
    .join("");

  if (currentBook.url) {
    box.innerHTML +=
      `<div class="meta-item"><span class="meta-label">网址</span>` +
      `<a class="meta-value link" href="${escapeHtml(currentBook.url)}" target="_blank" rel="noopener">打开原页面</a></div>`;
  }
}

function renderTags() {
  const box = document.getElementById("book-tags");
  box.innerHTML = "";
  (currentBook.tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.className = "detail-tag";
    span.innerText = tag;
    box.appendChild(span);
  });
}

/** 段落渲染：空行分段，段间距 0.6em */
function renderParagraphs(elementId, text, placeholder) {
  const box = document.getElementById(elementId);
  if (!box) return;

  const content = (text || "").trim();
  if (!content) {
    box.innerHTML = `<p class="muted">${placeholder || ""}</p>`;
    return;
  }

  box.innerHTML = content
    .split(/\n\s*\n|\n/)
    .filter((line) => line.trim())
    .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
    .join("");
}

function renderReview() {
  if (!currentBook.review) return;
  document.getElementById("review-card").classList.remove("hidden");
  renderParagraphs("book-review", currentBook.review, "");
}

async function renderExcerpts() {
  const list = (currentBook.excerpts || []).filter(
    (item) => (item.text && item.text.trim()) || (item.images && item.images.length)
  );
  if (list.length === 0) return;

  document.getElementById("excerpt-card").classList.remove("hidden");
  const box = document.getElementById("excerpt-view");
  box.innerHTML = "";

  for (const item of list) {
    const wrap = document.createElement("figure");
    wrap.className = "excerpt-block";

    if (item.text && item.text.trim()) {
      const quote = document.createElement("blockquote");
      quote.innerHTML = item.text
        .split(/\n/)
        .filter((l) => l.trim())
        .map((l) => `<p>${escapeHtml(l.trim())}</p>`)
        .join("");
      wrap.appendChild(quote);
    }

    if (item.images && item.images.length) {
      const gallery = document.createElement("div");
      gallery.className = "excerpt-images";

      for (const image of item.images) {
        const img = document.createElement("img");
        img.alt = image.name || "书摘图片";
        gallery.appendChild(img);

        if (image.assetId) {
          try {
            const asset = await getAsset(image.assetId);
            if (asset && asset.blob) img.src = URL.createObjectURL(asset.blob);
          } catch (e) {
            console.warn(e);
          }
        }
      }
      wrap.appendChild(gallery);
    }

    box.appendChild(wrap);
  }
}

/* ===============================
   附件 + 加密下载
================================ */
function renderAttachments() {
  const box = document.getElementById("attach-list");
  const list = currentBook.attachments || [];

  box.innerHTML = "";
  if (list.length === 0) {
    box.innerHTML = '<p class="muted">还没有附件</p>';
    return;
  }

  list.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "attach-item";

    if (item.kind === "link") {
      row.innerHTML = `
        <span class="attach-kind">链接</span>
        <span class="attach-name">${escapeHtml(item.name)}</span>
        <a class="mini-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">打开</a>
      `;
    } else {
      row.innerHTML = `
        <span class="attach-kind">${escapeHtml((item.ext || "file").toUpperCase())}</span>
        <span class="attach-name">${escapeHtml(item.name)}</span>
        <span class="attach-size">${formatSize(item.size)}</span>
        <button class="mini-btn">下载</button>
      `;
      row.querySelector("button").onclick = () => downloadAttachment(index);
    }

    box.appendChild(row);
  });
}

async function downloadAttachment(index) {
  const item = (currentBook.attachments || [])[index];
  if (!item || !item.assetId) {
    alert("这个附件的文件没找到");
    return;
  }

  const input = prompt("下载需要密码");
  if (input === null) return;

  if (input.trim() !== DOWNLOAD_PASSWORD) {
    alert("密码不对");
    return;
  }

  try {
    const asset = await getAsset(item.assetId);
    if (!asset || !asset.blob) {
      alert("文件已丢失");
      return;
    }

    const url = URL.createObjectURL(asset.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (e) {
    alert("下载失败：" + e.message);
  }
}

/* ===============================
   计时
================================ */
function renderTimer() {
  setText("total-time", formatDuration(currentBook.readSeconds || 0));
  setText("read-count", currentBook.readCount || 0);
}

function toggleTimer() {
  if (timerRunning) {
    stopTimer(false);
  } else {
    startTimer();
  }
}

function startTimer() {
  timerRunning = true;
  timerStart = Date.now();

  document.getElementById("timer-btn").innerText = "结束并记录";
  document.getElementById("timer-btn").classList.add("running");

  timerTick = setInterval(function () {
    const seconds = Math.floor((Date.now() - timerStart) / 1000);
    document.getElementById("timer-clock").innerText = clockText(seconds);
  }, 500);
}

function stopTimer(silent) {
  if (!timerRunning) return;

  clearInterval(timerTick);
  timerRunning = false;

  const updated = addReadSession(currentBook.id, timerStart, Date.now());
  if (updated) currentBook = updated;

  document.getElementById("timer-clock").innerText = "00:00:00";
  const btn = document.getElementById("timer-btn");
  btn.innerText = "开始计时";
  btn.classList.remove("running");

  if (!silent) {
    renderTimer();
    renderSessions();
  }
}

function clockText(totalSeconds) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function renderSessions() {
  const box = document.getElementById("session-list");
  const sessions = (currentBook.sessions || []).slice().reverse().slice(0, 8);

  if (sessions.length === 0) {
    box.innerHTML = '<p class="muted">还没有阅读记录</p>';
    return;
  }

  box.innerHTML =
    '<p class="session-head">最近记录</p>' +
    sessions
      .map((session) => {
        const start = new Date(session.start);
        const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
        const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
        return `<div class="session-item"><span>${date} ${time}</span><span>${formatDuration(session.seconds)}</span></div>`;
      })
      .join("");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/* ===============================
   进度
================================ */
function renderProgress() {
  const progress = currentBook.progress || 0;
  const range = document.getElementById("progress-range");

  range.value = progress;
  paintProgress(progress);

  range.oninput = function () {
    paintProgress(Number(range.value));
  };
  range.onchange = function () {
    currentBook.progress = Number(range.value);
    updateBook(currentBook);
  };
}

function paintProgress(progress) {
  document.getElementById("progress-value").style.width = progress + "%";
  setText("progress-label", progress + "%");

  const note = document.getElementById("progress-note");
  if (currentBook.words) {
    const read = Math.round((Number(currentBook.words) * progress) / 100);
    note.innerText = `约 ${read.toLocaleString()} / ${Number(currentBook.words).toLocaleString()} 字`;
  } else {
    note.innerText = "";
  }
}

/* ===============================
   操作
================================ */
function editBook() {
  if (timerRunning) stopTimer(true);
  location.href = "add-book.html?id=" + encodeURIComponent(currentBook.id);
}

async function removeBook() {
  if (!confirm(`删除《${currentBook.title}》？封面、附件、书摘都会一起删掉。`)) return;

  await deleteBook(currentBook.id);
  location.href = "index.html";
}

function startReading() {
  if (timerRunning) stopTimer(true);
  sessionStorage.setItem("currentBookId", currentBook.id);
  location.href = "reader.html?id=" + encodeURIComponent(currentBook.id);
}

function backShelf() {
  if (timerRunning) stopTimer(true);
  location.href = "index.html";
}

/* ===============================
   工具
================================ */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function escapeHtml(text) {
  return String(text === undefined || text === null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

window.toggleTimer = toggleTimer;
window.editBook = editBook;
window.removeBook = removeBook;
window.startReading = startReading;
window.backShelf = backShelf;
