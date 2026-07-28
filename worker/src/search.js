/* =====================================================
   页间集 · 按关键词找书

   两类来源：
     1. 三个小说站：抓它们自己的搜索结果页，取出候选作品链接
     2. 纸质书：豆瓣 suggest → Google Books → OpenLibrary，
        书名 / 作者 / ISBN 都能查，返回的信息可以直接填表

   晋江的搜索参数必须是 GBK 编码，而运行时只有 UTF-8 的 TextEncoder，
   所以这里用解码器反查出一张 GBK 编码表（只建一次，之后常驻）。
===================================================== */

import { toText, decodeEntities, metaContent } from "./scrape.js";

/* =====================================================
   GBK 编码（给晋江用）
===================================================== */

let gbkTable = null;

function buildGbkTable() {
  const table = new Map();
  const decoder = new TextDecoder("gb18030");
  const pair = new Uint8Array(2);

  // GBK 双字节区：首字节 0x81-0xFE，次字节 0x40-0xFE（跳过 0x7F）
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const char = decoder.decode(pair);
      if (char.length === 1 && char !== "\ufffd" && !table.has(char)) {
        table.set(char, [lead, trail]);
      }
    }
  }
  return table;
}

/** 把字符串按 GBK 百分号编码，ASCII 原样保留 */
export function gbkUrlEncode(text) {
  if (!gbkTable) gbkTable = buildGbkTable();

  let out = "";
  for (const char of String(text || "")) {
    const code = char.codePointAt(0);

    if (/[A-Za-z0-9\-_.~]/.test(char)) {
      out += char;
      continue;
    }
    if (code < 0x80) {
      out += "%" + code.toString(16).toUpperCase().padStart(2, "0");
      continue;
    }

    const bytes = gbkTable.get(char);
    if (bytes) {
      out += "%" + bytes[0].toString(16).toUpperCase() + "%" + bytes[1].toString(16).toUpperCase();
    } else {
      // 表里没有的字（生僻字、emoji）退回 UTF-8，搜不到总比整条请求废掉强
      for (const byte of new TextEncoder().encode(char)) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

/* =====================================================
   小说站搜索
===================================================== */

const NOVEL_SEARCH = {
  "jjwxc.net": {
    name: "晋江文学城",
    url: (q) => "https://www.jjwxc.net/search.php?kw=" + gbkUrlEncode(q) + "&t=1",
    link: /onebook\.php\?novelid=\d+/i,
    base: "https://www.jjwxc.net/",
  },
  "qidian.com": {
    name: "起点中文网",
    url: (q) => "https://www.qidian.com/so/" + encodeURIComponent(q) + ".html",
    link: /(?:www\.)?qidian\.com\/book\/\d+/i,
    base: "https://www.qidian.com/",
  },
  "fanqienovel.com": {
    name: "番茄小说",
    url: (q) => "https://fanqienovel.com/search?query=" + encodeURIComponent(q),
    link: /fanqienovel\.com\/page\/\d+|^\/page\/\d+/i,
    base: "https://fanqienovel.com/",
  },
};

export function novelSiteKey(site) {
  const value = String(site || "").toLowerCase();
  if (/jj|晋江/.test(value)) return "jjwxc.net";
  if (/qidian|起点/.test(value)) return "qidian.com";
  if (/fanqie|番茄/.test(value)) return "fanqienovel.com";
  return "";
}

/** 从搜索结果页里抠出候选作品 */
export function parseSearchResults(html, config) {
  const found = [];
  const seen = new Set();

  const anchor = /<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi;
  let hit;

  while ((hit = anchor.exec(html))) {
    const attrs = hit[1];
    const inner = hit[2];

    const href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || !config.link.test(href)) continue;

    let url = decodeEntities(href);
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/")) url = config.base.replace(/\/$/, "") + url;
    else if (!/^https?:/i.test(url)) url = config.base + url.replace(/^\.?\//, "");

    // 同一本书页面里会出现好几次，留信息最全的那次
    const title =
      toText(inner) ||
      decodeEntities((inner.match(/alt\s*=\s*["']([^"']+)["']/i) || [])[1] || "") ||
      decodeEntities((attrs.match(/title\s*=\s*["']([^"']+)["']/i) || [])[1] || "");

    const key = url.split("#")[0];
    if (!title || title.length > 60) continue;

    if (seen.has(key)) {
      const old = found.find((item) => item.url === key);
      if (old && old.title.length < title.length) old.title = title;
      continue;
    }

    seen.add(key);
    found.push({ title: title, url: key, source: config.name });
    if (found.length >= 20) break;
  }

  return found;
}

/* =====================================================
   纸质书：豆瓣 / Google Books / OpenLibrary
===================================================== */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const isIsbn = (q) => /^[\d\-\s]{10,17}[\dXx]?$/.test(String(q).trim());
const cleanIsbn = (q) => String(q).replace(/[^\dXx]/g, "");

async function fromDouban(query) {
  const url = "https://book.douban.com/j/subject_suggest?q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://book.douban.com/", Accept: "application/json" },
  });
  if (!response.ok) throw new Error("豆瓣返回 " + response.status);

  const list = await response.json();
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.title)
    .map((item) => ({
      title: item.title,
      author: item.author_name || "",
      year: item.year || "",
      coverUrl: (item.pic || "").replace(/^http:/, "https:"),
      url: item.url || "",
      source: "豆瓣读书",
    }));
}

async function fromGoogleBooks(query) {
  const q = isIsbn(query) ? "isbn:" + cleanIsbn(query) : query;
  const url = "https://www.googleapis.com/books/v1/volumes?maxResults=12&country=CN&q=" + encodeURIComponent(q);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Google Books 返回 " + response.status);

  const data = await response.json();
  return (data.items || []).map((item) => {
    const info = item.volumeInfo || {};
    const identifiers = info.industryIdentifiers || [];
    const isbn13 = identifiers.find((x) => x.type === "ISBN_13") || identifiers[0] || {};

    return {
      title: info.title + (info.subtitle ? "：" + info.subtitle : ""),
      author: (info.authors || []).join("、"),
      publisher: info.publisher || "",
      year: (info.publishedDate || "").slice(0, 4),
      description: info.description || "",
      isbn: isbn13.identifier || "",
      pages: info.pageCount || "",
      category: (info.categories || [])[0] || "",
      coverUrl: ((info.imageLinks || {}).thumbnail || "").replace(/^http:/, "https:"),
      url: info.infoLink || "",
      source: "Google Books",
    };
  });
}

async function fromOpenLibrary(query) {
  const url = isIsbn(query)
    ? "https://openlibrary.org/search.json?limit=12&isbn=" + cleanIsbn(query)
    : "https://openlibrary.org/search.json?limit=12&q=" + encodeURIComponent(query);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("OpenLibrary 返回 " + response.status);

  const data = await response.json();
  return (data.docs || []).map((doc) => ({
    title: doc.title || "",
    author: (doc.author_name || []).join("、"),
    publisher: (doc.publisher || [])[0] || "",
    year: doc.first_publish_year || "",
    isbn: (doc.isbn || [])[0] || "",
    pages: doc.number_of_pages_median || "",
    coverUrl: doc.cover_i ? "https://covers.openlibrary.org/b/id/" + doc.cover_i + "-M.jpg" : "",
    url: doc.key ? "https://openlibrary.org" + doc.key : "",
    source: "OpenLibrary",
  }));
}

/* =====================================================
   对外
===================================================== */

export async function searchBooks(query, site) {
  const keyword = String(query || "").trim();
  if (!keyword) throw Object.assign(new Error("要给一个关键词"), { code: 400 });

  const key = novelSiteKey(site);

  /* 小说站 */
  if (key) {
    const config = NOVEL_SEARCH[key];
    const { fetchPage } = await import("./scrape.js");
    const page = await fetchPage(config.url(keyword));

    if (!page.ok) {
      throw Object.assign(new Error(config.name + "搜索返回 " + page.status + "，可能被拦"), { code: 502 });
    }

    const results = parseSearchResults(page.html, config);
    return { source: config.name, keyword: keyword, charset: page.charset, results: results };
  }

  /* 纸质书：三个源依次试，谁先有结果用谁 */
  const tried = [];
  for (const [name, lookup] of [
    ["豆瓣读书", fromDouban],
    ["Google Books", fromGoogleBooks],
    ["OpenLibrary", fromOpenLibrary],
  ]) {
    try {
      const results = await lookup(keyword);
      if (results.length) return { source: name, keyword: keyword, tried: tried, results: results };
      tried.push(name + "：没结果");
    } catch (error) {
      tried.push(name + "：" + (error.message || error));
    }
  }

  return { source: "", keyword: keyword, tried: tried, results: [] };
}
