/* =====================================================
   页间集 · 阅读器
   支持 EPUB / TXT，文件来自书籍附件
===================================================== */

let currentBook = null;
let currentFile = null;
let epubBook = null;
let rendition = null;
let startReadTime = null;

document.addEventListener("DOMContentLoaded", initReader);

async function initReader() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || sessionStorage.getItem("currentBookId");

  currentBook = id ? getBookById(id) : null;
  if (!currentBook) {
    alert("没有选择书籍");
    location.href = "index.html";
    return;
  }

  startReadTime = Date.now();
  const title = document.querySelector("#reader-title");
  if (title) title.innerText = currentBook.title;

  await loadFile();
}

/** 优先用附件里的 epub/txt，其次用旧版整本书文件 */
async function loadFile() {
  const readable = (currentBook.attachments || []).filter(
    (a) => a.kind === "file" && ["epub", "txt"].includes((a.ext || "").toLowerCase())
  );

  if (readable.length > 0) {
    try {
      const asset = await getAsset(readable[0].assetId);
      if (asset && asset.blob) {
        currentFile = new File([asset.blob], readable[0].name, { type: asset.mime || "" });
      }
    } catch (e) {
      console.warn(e);
    }
  }

  if (!currentFile) {
    try {
      const legacy = await getFile(currentBook.id);
      if (legacy && legacy.file) currentFile = legacy.file;
    } catch (e) {
      console.warn(e);
    }
  }

  if (!currentFile) {
    showUnsupported("这本书还没有可以直接阅读的文件");
    return;
  }

  const ext = (currentFile.name.split(".").pop() || "").toLowerCase();
  if (ext === "epub") openEPUB();
  else if (ext === "txt") openTXT();
  else showUnsupported(ext.toUpperCase() + " 无法在浏览器里直接阅读，建议用 Calibre 转成 EPUB");
}

async function openEPUB() {
  if (typeof ePub !== "function") {
    showUnsupported("epub.js 没加载成功，检查网络");
    return;
  }

  const url = URL.createObjectURL(currentFile);
  epubBook = ePub(url);
  rendition = epubBook.renderTo("reader", { width: "100%", height: "100%", flow: "paginated" });

  await epubBook.ready;
  await epubBook.locations.generate(1600).catch(() => {});

  rendition.display(currentBook.position || undefined);

  rendition.on("relocated", function (location) {
    const cfi = location.start.cfi;
    currentBook.position = cfi;

    try {
      const percent = epubBook.locations.percentageFromCfi(cfi);
      const progress = Math.floor(percent * 100);
      if (!isNaN(progress)) {
        currentBook.progress = progress;
        updateProgressText(progress);
      }
    } catch (e) {}

    updateBook(currentBook);
  });
}

function openTXT() {
  const reader = new FileReader();
  reader.onload = function (e) {
    const box = document.querySelector("#reader");
    box.innerHTML = `<div class="text-reader">${String(e.target.result)
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
      .replace(/\n/g, "<br>")}</div>`;
  };
  reader.readAsText(currentFile, "UTF-8");
}

function showUnsupported(text) {
  const box = document.querySelector("#reader");
  box.innerHTML = `<div class="empty-state"><h3>${text}</h3><p>可以回到详情页手动记录进度</p></div>`;
}

function nextPage() { if (rendition) rendition.next(); }
function prevPage() { if (rendition) rendition.prev(); }

function increaseFont() {
  if (rendition) rendition.themes.fontSize("120%");
  const txt = document.querySelector(".text-reader");
  if (txt) txt.style.fontSize = "120%";
}

function decreaseFont() {
  if (rendition) rendition.themes.fontSize("90%");
  const txt = document.querySelector(".text-reader");
  if (txt) txt.style.fontSize = "90%";
}

function darkMode() { document.body.classList.toggle("dark-reader"); }

function fullScreen() {
  const page = document.querySelector(".reader-page");
  if (page.requestFullscreen) page.requestFullscreen();
}

function saveReadTime() {
  if (!startReadTime) return;
  addReadSession(currentBook.id, startReadTime, Date.now());
  startReadTime = null;
}

function closeReader() {
  saveReadTime();
  if (rendition) rendition.destroy();
  location.href = "book-detail.html?id=" + encodeURIComponent(currentBook.id);
}

window.addEventListener("beforeunload", saveReadTime);

document.addEventListener("keydown", function (e) {
  if (e.key === "ArrowRight") nextPage();
  if (e.key === "ArrowLeft") prevPage();
});

function updateProgressText(progress) {
  const bar = document.querySelector("#reader-progress");
  const text = document.querySelector("#reading-progress-text");
  if (bar) bar.style.width = progress + "%";
  if (text) text.innerText = progress + "%";
}

window.nextPage = nextPage;
window.prevPage = prevPage;
window.increaseFont = increaseFont;
window.decreaseFont = decreaseFont;
window.darkMode = darkMode;
window.fullScreen = fullScreen;
window.closeReader = closeReader;
