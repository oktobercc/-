/* =====================================================
   Reading OS
   Reader Controller

   Support:
   EPUB
   TXT
   MOBI
   AZW3

   不涉及封面，封面由书架和详情页异步加载
===================================================== */


let currentBook = null;
let currentFile = null;
let epubBook = null;
let rendition = null;
let readerType = "";
let startReadTime = null;



// ===============================
// 页面初始化
// ===============================


document.addEventListener(
  "DOMContentLoaded",
  function () {
    initReader();
  }
);



async function initReader() {
  const data = sessionStorage.getItem("currentBook");
  if (!data) {
    alert("没有选择书籍");
    location.href = "index.html";
    return;
  }

  currentBook = JSON.parse(data);
  startReadTime = Date.now();

  showBookTitle();
  await loadFile();
}





// ===============================
// 显示标题
// ===============================


function showBookTitle() {
  const title = document.querySelector("#reader-title");
  if (title) {
    title.innerText = currentBook.title;
  }
}





// ===============================
// 获取文件
// ===============================


async function loadFile() {
  const result = await getFile(currentBook.id);
  if (!result) {
    alert("找不到电子书文件");
    return;
  }

  currentFile = result.file;
  const ext = getExtension(currentFile.name);

  switch (ext) {
    case "epub":
      readerType = "epub";
      openEPUB();
      break;
    case "txt":
      readerType = "txt";
      openTXT();
      break;
    case "mobi":
      readerType = "mobi";
      showUnsupported("MOBI格式暂不支持浏览器直接阅读");
      break;
    case "azw3":
      readerType = "azw3";
      showUnsupported("AZW3格式暂不支持浏览器直接阅读");
      break;
    default:
      showUnsupported("未知文件格式");
  }
}



function getExtension(filename) {
  return filename.split(".").pop().toLowerCase();
}





// =================================================
// EPUB
// =================================================


async function openEPUB() {
  const url = URL.createObjectURL(currentFile);
  epubBook = ePub(url);
  rendition = epubBook.renderTo(
    "reader",
    {
      width: "100%",
      height: "100%",
      flow: "paginated"
    }
  );

  await epubBook.ready;

  if (currentBook.position) {
    rendition.display(currentBook.position);
  } else {
    rendition.display();
  }

  rendition.on("relocated", function (location) {
    const cfi = location.start.cfi;
    currentBook.position = cfi;

    try {
      const percent = epubBook.locations.percentageFromCfi(cfi);
      const progress = Math.floor(percent * 100);
      currentBook.progress = progress;
      updateProgressText(progress);
    } catch (e) {}

    updateBook(currentBook);
  });
}





// =================================================
// TXT
// =================================================


function openTXT() {
  const reader = new FileReader();
  reader.onload = function (e) {
    const box = document.querySelector("#reader");
    box.innerHTML = `
      <div class="text-reader">
        ${e.target.result.replace(/\n/g, "<br>")}
      </div>
    `;
  };
  reader.readAsText(currentFile, "UTF-8");
}





// =================================================
// 不支持格式
// =================================================


function showUnsupported(text) {
  const box = document.querySelector("#reader");
  box.innerHTML = `
    <div class="empty-state">
      <h2>${text}</h2>
      <p>建议使用 Calibre 转换为 EPUB</p>
    </div>
  `;
}





// ===============================
// 翻页
// ===============================


function nextPage() {
  if (rendition) {
    rendition.next();
  }
}


function prevPage() {
  if (rendition) {
    rendition.prev();
  }
}





// ===============================
// 字体
// ===============================


function increaseFont() {
  if (rendition) {
    rendition.themes.fontSize("120%");
  }
  const txt = document.querySelector(".text-reader");
  if (txt) {
    txt.style.fontSize = "120%";
  }
}


function decreaseFont() {
  if (rendition) {
    rendition.themes.fontSize("90%");
  }
  const txt = document.querySelector(".text-reader");
  if (txt) {
    txt.style.fontSize = "90%";
  }
}





// ===============================
// 夜间模式
// ===============================


function darkMode() {
  document.body.classList.toggle("dark-reader");
}





// ===============================
// 全屏
// ===============================


function fullScreen() {
  const page = document.querySelector(".reader-page");
  if (page.requestFullscreen) {
    page.requestFullscreen();
  }
}





// ===============================
// 保存阅读时间
// ===============================


function saveReadTime() {
  const minutes = Math.floor((Date.now() - startReadTime) / 60000);
  if (minutes > 0) {
    currentBook.readTime = (currentBook.readTime || 0) + minutes;
    updateBook(currentBook);
  }
}





// ===============================
// 返回
// ===============================


function closeReader() {
  saveReadTime();
  if (rendition) {
    rendition.destroy();
  }
  location.href = "book-detail.html";
}





// ===============================
// 键盘控制
// ===============================


document.addEventListener("keydown", function (e) {
  if (e.key === "ArrowRight") {
    nextPage();
  }
  if (e.key === "ArrowLeft") {
    prevPage();
  }
});





// ===============================
// 更新进度显示
// ===============================


function updateProgressText(progress) {
  const bar = document.querySelector("#reader-progress");
  const text = document.querySelector("#reading-progress-text");
  if (bar) {
    bar.style.width = progress + "%";
  }
  if (text) {
    text.innerText = progress + "%";
  }
}





// ===============================
// 暴露
// ===============================


window.nextPage = nextPage;
window.prevPage = prevPage;
window.increaseFont = increaseFont;
window.decreaseFont = decreaseFont;
window.darkMode = darkMode;
window.fullScreen = fullScreen;
window.closeReader = closeReader;