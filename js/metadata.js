/* =====================================================
   页间集 · 元数据读取
   1) 从 EPUB / TXT 文件读取 书名/作者/简介/出版社/封面
   2) 从 晋江 / 起点 / 番茄 的网页读取书籍信息
===================================================== */

/* ===============================
   一、本地文件
================================ */
async function readMetaFromFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "epub") return readEpubMeta(file);
  if (ext === "txt") return readTxtMeta(file);

  return {
    title: file.name.replace(/\.[^/.]+$/, ""),
    note: ext.toUpperCase() + " 只能读出文件名，其余信息请手动填",
  };
}

async function readEpubMeta(file) {
  // 优先用内置解析器（js/epub-meta.js）：零依赖、不联网、只解压需要的几个文件
  if (typeof readEpubMetaLocal === "function") {
    try {
      return await readEpubMetaLocal(file);
    } catch (err) {
      console.warn("内置 EPUB 解析失败，改用 epub.js 再试一次", err);
    }
  }

  // 退回 epub.js（需要 CDN 或本地放一份 epub.min.js）
  if (typeof ePub !== "function") {
    throw new Error("这个 EPUB 读不出来，epub.js 也没加载成功");
  }

  const url = URL.createObjectURL(file);
  const book = ePub(url);

  try {
    await book.ready;
    const meta = book.packaging && book.packaging.metadata ? book.packaging.metadata : {};

    const result = {
      title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
      author: meta.creator || "",
      publisher: meta.publisher || "",
      description: stripHtml(meta.description || ""),
      coverBlob: null,
    };

    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) {
        const response = await fetch(coverUrl);
        result.coverBlob = await response.blob();
      }
    } catch (e) {
      console.warn("封面提取失败", e);
    }

    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readTxtMeta(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      const head = String(e.target.result).slice(0, 3000);
      const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

      const result = {
        title: file.name.replace(/\.[^/.]+$/, ""),
        author: "",
        description: "",
      };

      // 常见的 TXT 头部写法：书名：xxx / 作者：xxx
      const titleMatch = head.match(/(?:书名|标题)[：:]\s*(.+)/);
      const authorMatch = head.match(/(?:作者|著)[：:]\s*(.+)/);
      if (titleMatch) result.title = titleMatch[1].trim();
      if (authorMatch) result.author = authorMatch[1].trim();

      const introMatch = head.match(/(?:简介|内容简介|文案)[：:]\s*([\s\S]{0,400})/);
      if (introMatch) {
        result.description = introMatch[1].trim();
      } else if (lines.length > 2) {
        result.description = lines.slice(1, 6).join("\n");
      }

      resolve(result);
    };

    reader.onerror = () => resolve({ title: file.name.replace(/\.[^/.]+$/, "") });
    reader.readAsText(file.slice(0, 20000), "UTF-8");
  });
}

/* ===============================
   二、网页
================================ */
function detectSite(url) {
  if (/jjwxc\.net/i.test(url)) return "晋江文学城";
  if (/qidian\.com/i.test(url)) return "起点中文网";
  if (/fanqienovel\.com/i.test(url)) return "番茄小说网";
  return "";
}

/**
 * 直接抓取网页。浏览器同源策略会拦大部分小说站，
 * 抓不到时抛错，调用方引导用户改用「粘贴网页源码」。
 */
async function fetchPage(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("网页返回 " + response.status);

  const buffer = await response.arrayBuffer();
  // 晋江是 GB2312/GBK，先按 gbk 解，失败再退回 utf-8
  let text = "";
  try {
    if (/jjwxc\.net/i.test(url)) {
      text = new TextDecoder("gbk").decode(buffer);
    } else {
      text = new TextDecoder("utf-8").decode(buffer);
    }
  } catch (e) {
    text = new TextDecoder("utf-8").decode(buffer);
  }
  return text;
}

function parseBookPage(html, url) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const site = detectSite(url || "");

  let data = {};
  if (site === "晋江文学城") data = parseJJ(doc);
  else if (site === "起点中文网") data = parseQidian(doc);
  else if (site === "番茄小说网") data = parseFanqie(doc);

  // 通用兜底：Open Graph / meta
  const og = parseOpenGraph(doc);
  ["title", "author", "description", "coverUrl", "publisher"].forEach((key) => {
    if (!data[key] && og[key]) data[key] = og[key];
  });

  if (!data.words) data.words = extractWordCount(doc.body ? doc.body.textContent : "");
  if (site) data.source = site;
  if (url) data.url = url;

  return data;
}

function parseOpenGraph(doc) {
  const pick = (selector, attr) => {
    const el = doc.querySelector(selector);
    return el ? (el.getAttribute(attr) || "").trim() : "";
  };

  return {
    title: pick('meta[property="og:title"]', "content") || pick('meta[name="title"]', "content") ||
           (doc.querySelector("title") ? doc.querySelector("title").textContent.trim() : ""),
    author: pick('meta[property="og:novel:author"]', "content") || pick('meta[name="author"]', "content"),
    description: pick('meta[property="og:description"]', "content") || pick('meta[name="description"]', "content"),
    coverUrl: pick('meta[property="og:image"]', "content"),
    publisher: pick('meta[property="og:novel:category"]', "content"),
  };
}

function parseJJ(doc) {
  const text = (selector) => {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : "";
  };

  const cover = doc.querySelector('img[src*="novelimage"], .noveldefaultimage img, #novelimage img');

  return {
    title: text('span[itemprop="articleSection"]') || text("h1 span") || text("h1"),
    author: text('span[itemprop="author"]') || text('a[href*="oneauthor"]'),
    description: text("#novelintro"),
    coverUrl: cover ? cover.getAttribute("src") : "",
    publisher: "晋江文学城",
  };
}

function parseQidian(doc) {
  const text = (selector) => {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : "";
  };

  const cover = doc.querySelector(".book-cover img, #bookImg img, .book-img img");

  return {
    title: text(".book-title, .book-info h1 em, h2.book-title"),
    author: text(".book-author, .book-info h1 a.writer, .author-name"),
    description: text(".book-intro, .book-info-detail .intro, #book-intro-detail"),
    coverUrl: cover ? cover.getAttribute("src") : "",
    publisher: "起点中文网",
  };
}

function parseFanqie(doc) {
  const text = (selector) => {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : "";
  };

  const cover = doc.querySelector(".book-cover img, .info-cover img, img.cover");

  return {
    title: text(".info-name h1, .info-name, h1"),
    author: text(".author-name-text, .author-name, .info-author"),
    description: text(".page-abstract-content, .book-abstract, .info-abstract"),
    coverUrl: cover ? cover.getAttribute("src") : "",
    publisher: "番茄小说网",
  };
}

function extractWordCount(text) {
  if (!text) return "";
  const wan = text.match(/([\d.]+)\s*万字/);
  if (wan) return String(Math.round(parseFloat(wan[1]) * 10000));

  const plain = text.match(/([\d,]{4,})\s*字/);
  if (plain) return plain[1].replace(/,/g, "");

  return "";
}

function stripHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}

/** 把远程封面地址抓成 Blob；跨域大概率失败，失败返回 null */
async function fetchCoverBlob(coverUrl, pageUrl) {
  if (!coverUrl) return null;

  // 有后端就让它代取：小说站的图床基本都不给跨域
  if (window.CloudSync && CloudSync.configured()) {
    const viaWorker = await CloudSync.proxyImage(coverUrl);
    if (viaWorker) return viaWorker;
  }

  try {
    const absolute = new URL(coverUrl, pageUrl || location.href).href;
    const response = await fetch(absolute, { mode: "cors" });
    if (!response.ok) return null;
    return await response.blob();
  } catch (e) {
    console.warn("封面抓取失败（跨域），请手动上传", e);
    return null;
  }
}

window.readMetaFromFile = readMetaFromFile;
window.fetchPage = fetchPage;
window.parseBookPage = parseBookPage;
window.detectSite = detectSite;
window.fetchCoverBlob = fetchCoverBlob;
