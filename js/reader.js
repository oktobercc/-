console.log("reader.js loaded");
console.log("epub:",typeof ePub);
/* =====================================================
   页间集 · 阅读器
   支持 EPUB / TXT，文件来自书籍附件
===================================================== */

let currentBook = null;
let currentFile = null;
let epubBook = null;
let rendition = null;
let startReadTime = null;

// 全局样式状态
const readerState = {
  fontFamily: 'STSong',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.3, // 默认 130%
  padding: 20,
  transitionMode: 'simulation',
  bookType: null, // 'txt' 或 'epub'
  rendition: null,
  epubBook: null
};

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

async function loadFile(){

const readable=(currentBook.attachments||[]).filter(
a=>a.kind==="file" &&
["epub","txt"].includes((a.ext||"").toLowerCase())
);


if(readable.length>0){

    try{

        const asset=await getAsset(readable[0].assetId);

        if(asset && asset.blob){

            currentFile=new File(
                [asset.blob],
                readable[0].name,
                {
                    type:asset.mime || "application/epub"
                }
            );

        }

    }catch(e){

        console.warn("附件读取失败",e);

    }

}


if(!currentFile){

    try{

        const legacy=await getFile(currentBook.id);

        if(legacy && legacy.file){
            currentFile=legacy.file;
        }

    }catch(e){

        console.warn(e);

    }

}


console.log("当前文件:",currentFile);


if(!currentFile){

    showUnsupported("这本书还没有可以直接阅读的文件");
    return;

}


const ext=currentFile.name.split(".").pop().toLowerCase();


if(ext==="epub"){
    openEPUB();
}
else if(ext==="txt"){
    openTXT();
}

}
async function openEPUB() {
  if (typeof ePub !== "function") {
    showUnsupported("epub.js 没加载成功，检查网络");
    return;
  }

  let url = null;
  try {
    url = URL.createObjectURL(currentFile);
    epubBook = ePub(url);
   rendition = epubBook.renderTo(
    "viewer",
    {
        width: "100%",
        height: "100%",
        flow: "paginated"
    }
);

readerState.bookType = "epub";
readerState.rendition = rendition;
readerState.epubBook = epubBook;

    await epubBook.ready;
    if(currentFile.size < 50 * 1024 * 1024){
    await epubBook.locations.generate(1600).catch(()=>{});
}

    await rendition.display(currentBook.position || undefined);

generateToc();

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
  } catch (err) {
    console.error("EPUB 打开失败", err);
    if (url) URL.revokeObjectURL(url);
    showUnsupported("这本 EPUB 打不开：" + (err && err.message ? err.message : "格式错误"));
  }
}

function openTXT(){

const box=document.querySelector("#viewer");

const reader = document.createElement("div");

reader.className="text-reader";

const fr=new FileReader();

fr.onload=function(e){

reader.innerHTML =
String(e.target.result)
.replace(/[&<>]/g,c=>({
"&":"&amp;",
"<":"&lt;",
">":"&gt;"
}[c]))
.replace(/\n/g,"<br>");

box.innerHTML="";
box.appendChild(reader);

}

fr.readAsText(currentFile,"UTF-8");

}

function showUnsupported(text){

const box=document.querySelector("#viewer");

if(!box)return;

box.innerHTML=`
<div class="empty-state">
<h3>${text}</h3>
<p>可以回到详情页手动记录进度</p>
</div>
`;

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

/**
 * 1. EPUB 智能缩进处理
 * 识别段落是否有 CSS 缩进或全角/半角空格缩进，没有则自动补充
 */
function handleEpubIndentation(contents) {
  const doc = contents.document;
  const paragraphs = doc.querySelectorAll('p');
  
  paragraphs.forEach(p => {
    const text = p.textContent || '';
    const computedStyle = contents.window.getComputedStyle(p);
    
    // 检查 CSS 层面的缩进
    const textIndent = computedStyle.textIndent;
    const hasCssIndent = textIndent && textIndent !== '0px' && textIndent !== '0em';
    
    // 检查文本本身的物理空格缩进 (2个半角空格、1个全角空格等)
    const hasSpaceIndent = text.startsWith('  ') || text.startsWith(' ');
    
    // 如果既没有 CSS 缩进，也没有物理空格缩进，则强制应用 2em 缩进
    if (!hasCssIndent && !hasSpaceIndent) {
      p.style.textIndent = '2em';
    }
  });
}

/**
 * 3. 动态应用样式 (支持行距 130%、自定义字体、边距)
 */
function applyEpubStyles() {
  if (!readerState.rendition) return;
  
  readerState.rendition.themes.default({
    'p': {
      'font-family': `"${readerState.fontFamily}", sans-serif !important`,
      'font-size': `${readerState.fontSize}px !important`,
      'font-weight': `${readerState.fontWeight} !important`,
      'line-height': `${readerState.lineHeight} !important`,
      'text-align': 'justify'
    },
    'body': {
      'padding': `0 ${readerState.padding}px !important`
    }
  });
}

/**
 * 4. 用户自定义字体读取 (加载本地文件夹/字体文件)
 */
document.getElementById('custom-font-input').addEventListener('change', async (e) => {
  const files = e.target.files;
  for (const file of files) {
    if (/\.(ttf|otf|woff|woff2)$/i.test(file.name)) {
      const fontName = file.name.split('.')[0];
      const fontBuffer = await file.arrayBuffer();
      
      // 使用 FontFace API 动态注册字体
      const customFont = new FontFace(fontName, fontBuffer);
      await customFont.load();
      document.fonts.add(customFont);
      
      // 将字体追加到下拉列表中并选中
      const select = document.getElementById('font-select');
      const option = document.createElement('option');
      option.value = fontName;
      option.textContent = `${fontName} (本地导入)`;
      select.appendChild(option);
      select.value = fontName;
      
      readerState.fontFamily = fontName;
      if(readerState.bookType === 'epub') applyEpubStyles();
      else updateTxtStyles();
    }
  }
});

/**
 * 5. 翻页效果分发与执行
 */
function turnPage(direction) {

  const viewer = document.getElementById("viewer");


  // 翻页动画
  const animClass = `mode-${readerState.transitionMode}`;

  if (viewer && readerState.transitionMode !== "scroll") {

    viewer.classList.add(animClass);

    setTimeout(() => {
      viewer.classList.remove(animClass);
    }, readerState.transitionMode === "eink" ? 200 : 300);

  }



  // EPUB 翻页
  if (rendition) {

    if (direction === "next") {
      rendition.next();
    } else {
      rendition.prev();
    }

    return;
  }



  // TXT 翻页
  const txtReader = document.querySelector(".text-reader");

  if (txtReader) {

    const scrollOffset = viewer.clientHeight * 0.95;

    viewer.scrollBy({

      top: direction === "next"
        ? scrollOffset
        : -scrollOffset,

      behavior:
        readerState.transitionMode === "scroll"
        ? "smooth"
        : "auto"

    });

  }

}

/**
 * 6. 生成并绑定目录
 */
function generateToc() {
  if (!readerState.epubBook) return;
  readerState.epubBook.loaded.navigation.then(nav => {
    const tocList = document.getElementById('toc-list');
    tocList.innerHTML = '';
    nav.toc.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item.label;
      li.onclick = () => {
        readerState.rendition.display(item.href);
        document.getElementById('toc-sidebar').classList.add('hidden');
      };
      tocList.appendChild(li);
    });
  });
}
window.nextPage = nextPage;
window.prevPage = prevPage;
window.increaseFont = increaseFont;
window.decreaseFont = decreaseFont;
window.darkMode = darkMode;
window.fullScreen = fullScreen;
window.closeReader = closeReader;
window.turnPage = turnPage;
