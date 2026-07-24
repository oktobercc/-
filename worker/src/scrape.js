/* =====================================================
   页间集 · 后端抓取
   在 Cloudflare Worker 里跑，负责浏览器干不了的两件事：
     1. 跨域抓页面（浏览器会被同源策略拦住）
     2. 处理非 UTF-8 编码（晋江是 GB2312）

   解析分三层，逐层兜底：
     ① JSON-LD（<script type="application/ld+json">）
     ② Open Graph / 普通 meta
     ③ 各站自己的 HTML 规律
   哪一层出的结果会写在返回值的 matchedBy 里，站点改版时好排查。
===================================================== */

export const SITES = {
  "jjwxc.net": {
    name: "晋江文学城",
    charset: "gb18030",
    referer: "https://www.jjwxc.net/",
  },
  "qidian.com": {
    name: "起点中文网",
    charset: "utf-8",
    referer: "https://www.qidian.com/",
  },
  "fanqienovel.com": {
    name: "番茄小说",
    charset: "utf-8",
    referer: "https://fanqienovel.com/",
  },
};

export function siteOf(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
  const key = Object.keys(SITES).find((domain) => host === domain || host.endsWith("." + domain));
  return key ? Object.assign({ domain: key }, SITES[key]) : null;
}

/* =====================================================
   取页面：带上像样的请求头，按站点声明的编码解码
===================================================== */

export async function fetchRaw(url) {
  const site = siteOf(url);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: (site && site.referer) || url,
    },
    redirect: "follow",
    cf: { cacheTtl: 300, cacheEverything: false },
  });

  const buffer = await response.arrayBuffer();
  const declared = normalizeCharset(
    charsetFromHeader(response.headers.get("content-type")) ||
      charsetFromHtml(buffer) ||
      (site && site.charset) ||
      "utf-8"
  );

  return {
    status: response.status,
    ok: response.ok,
    buffer: buffer,
    charset: declared,
    finalUrl: response.url || url,
  };
}

/** 取回来并解码成字符串 */
export async function fetchPage(url) {
  const raw = await fetchRaw(url);
  const decoded = decodeBuffer(raw.buffer, raw.charset);

  return {
    status: raw.status,
    ok: raw.ok,
    html: decoded.text,
    charset: decoded.charset,
    /* Worker 运行时不一定带得全 GBK 解码表；解不了时这里为 true，
       前端会自动改走 /api/proxy，拿原始字节用浏览器的 TextDecoder 再解一次 */
    garbled: decoded.garbled,
    finalUrl: raw.finalUrl,
  };
}

function charsetFromHeader(contentType) {
  const m = (contentType || "").match(/charset=["']?([\w-]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function charsetFromHtml(buffer) {
  // 头部 2KB 里的 <meta charset> —— 用 latin1 粗解一下就够看
  const head = new TextDecoder("latin1").decode(buffer.slice(0, 2048));
  const m =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ||
    head.match(/content=["'][^"']*charset=([\w-]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function decodeBuffer(buffer, charset) {
  const label = normalizeCharset(charset);

  /* 页面声明的编码经常是错的（尤其是站点改版之后）。
     先严格按 UTF-8 试一次：能解通且有中文，说明它其实就是 UTF-8，
     直接用；GBK 的字节序列几乎不可能是合法 UTF-8，会在这里抛出去。 */
  if (label !== "utf-8") {
    try {
      const strict = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (/[\u4e00-\u9fa5]/.test(strict)) {
        return { text: strict, charset: "utf-8", garbled: false };
      }
    } catch (e) {
      /* 不是合法 UTF-8，按页面声明的编码来 */
    }
  }

  try {
    const text = new TextDecoder(label, { fatal: false }).decode(buffer);
    return { text: text, charset: label, garbled: looksGarbled(text) };
  } catch (e) {
    // 运行时不认这个编码，退回 utf-8，并标记结果不可信
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return { text: text, charset: "utf-8", garbled: label !== "utf-8" || looksGarbled(text) };
  }
}

function normalizeCharset(charset) {
  const value = (charset || "utf-8").toLowerCase();
  if (value === "gb2312" || value === "gbk" || value === "gb-2312") return "gb18030";
  if (value === "utf8") return "utf-8";
  return value;
}

/** 中文页面解错码时会出现大量 U+FFFD 或 Ã/æ 这类拉丁乱码 */
export function looksGarbled(text) {
  if (!text) return false;
  const sample = text.slice(0, 4000);
  const replacement = (sample.match(/\uFFFD/g) || []).length;
  if (replacement > 8) return true;

  // 中文被当成 latin1 解出来，满屏都是 Ã Î Ö 这类字符
  const cjk = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (sample.match(/[\u00c0-\u00ff]/g) || []).length;
  return latin / Math.max(1, sample.length) > 0.15 && cjk < sample.length * 0.02;
}

/* =====================================================
   文本小工具
===================================================== */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…",
  mdash: "—", ndash: "–", middot: "·", times: "×", copy: "©",
};

export function decodeEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (whole, code) {
    if (code[0] === "#") {
      const number =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      if (!isFinite(number) || number < 0 || number > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(number);
      } catch (e) {
        return whole;
      }
    }
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

/** 去标签转纯文本，<br> 和 </p> 换成换行 */
export function toText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<\s*script[\s\S]*?<\/script>/gi, "")
      .replace(/<\s*style[\s\S]*?<\/style>/gi, "")
      .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pick(html, patterns) {
  for (let i = 0; i < patterns.length; i++) {
    const m = html.match(patterns[i]);
    if (m && m[1]) {
      const text = toText(m[1]);
      if (text) return text;
    }
  }
  return "";
}

export function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pick(html, [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + escaped + '["\'][^>]+content=["\']([^"\']*)["\']', "i"),
    new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']' + escaped + '["\']', "i"),
  ]);
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const value = JSON.parse(m[1].trim());
      if (Array.isArray(value)) out.push.apply(out, value);
      else out.push(value);
    } catch (e) {
      /* 页面里的 ld+json 写错了就算了 */
    }
  }
  return out;
}

function absoluteUrl(link, base) {
  if (!link) return "";
  try {
    return new URL(link, base).href;
  } catch (e) {
    return link.indexOf("//") === 0 ? "https:" + link : link;
  }
}

function wordsFrom(text) {
  if (!text) return "";
  const wan = text.match(/([\d.]+)\s*万字/);
  if (wan) return String(Math.round(parseFloat(wan[1]) * 10000));
  const plain = text.match(/([\d,]{4,})\s*字/);
  if (plain) return plain[1].replace(/,/g, "");
  return "";
}

/* =====================================================
   三层解析
===================================================== */

export function parseBook(html, url) {
  const site = siteOf(url);
  const data = {
    title: "", author: "", description: "", coverUrl: "",
    publisher: site ? site.name : "", source: site ? site.name : "",
    words: "", category: "", tags: [], url: url,
    matchedBy: [],
  };

  const take = (field, value, from) => {
    if (!data[field] && value) {
      data[field] = value;
      data.matchedBy.push(field + ":" + from);
    }
  };

  /* ① JSON-LD */
  jsonLdBlocks(html).forEach(function (node) {
    if (!node || typeof node !== "object") return;
    const type = String(node["@type"] || "").toLowerCase();
    if (type && !/book|creativework|novel|article|product/.test(type)) return;

    take("title", clean(node.name), "ld+json");
    take("author", clean(nameOf(node.author)), "ld+json");
    take("description", clean(node.description), "ld+json");
    take("coverUrl", absoluteUrl(urlOf(node.image), url), "ld+json");
  });

  /* ② Open Graph / 通用 meta */
  take("title", metaContent(html, "og:title") || metaContent(html, "og:novel:book_name"), "og");
  take("author", metaContent(html, "og:novel:author") || metaContent(html, "author"), "og");
  take("description", metaContent(html, "og:description") || metaContent(html, "description"), "og");
  take("coverUrl", absoluteUrl(metaContent(html, "og:image"), url), "og");
  take("category", metaContent(html, "og:novel:category"), "og");

  /* ③ 各站自己的规律 */
  const rules = site ? RULES[site.domain] : null;
  if (rules) {
    take("title", pick(html, rules.title || []), site.domain);
    take("author", pick(html, rules.author || []), site.domain);
    take("description", pick(html, rules.description || []), site.domain);
    take("coverUrl", absoluteUrl(rawPick(html, rules.cover || []), url), site.domain);
    take("category", pick(html, rules.category || []), site.domain);
    if (!data.words) data.words = wordsFrom(pick(html, rules.words || []) || html.slice(0, 60000));
  }

  if (!data.title) take("title", pick(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]), "title标签");
  if (!data.words) data.words = wordsFrom(toText(html.slice(0, 60000)));

  // 标题里常带「- 晋江文学城」这类后缀
  data.title = trimSiteSuffix(data.title);
  data.description = tidyDescription(data.description);

  return data;
}

function rawPick(html, patterns) {
  for (let i = 0; i < patterns.length; i++) {
    const m = html.match(patterns[i]);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return "";
}

function clean(value) {
  return value ? toText(String(value)) : "";
}

function nameOf(author) {
  if (!author) return "";
  if (typeof author === "string") return author;
  if (Array.isArray(author)) return author.map(nameOf).filter(Boolean).join("、");
  return author.name || "";
}

function urlOf(image) {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return urlOf(image[0]);
  return image.url || image.contentUrl || "";
}

function trimSiteSuffix(title) {
  return String(title || "")
    .replace(/[-_|—–]\s*(晋江文学城|起点中文网|番茄小说|阅文集团旗下网站)[\s\S]*$/, "")
    .replace(/《|》/g, "")
    .trim();
}

function tidyDescription(text) {
  return String(text || "")
    .replace(/^内容标签[：:][\s\S]*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

/* 各站规律：每个字段给几条备选，站点小改版也不至于全瞎 */
const RULES = {
  "jjwxc.net": {
    title: [
      /<span[^>]+itemprop=["']articleSection["'][^>]*>([\s\S]*?)<\/span>/i,
      /<h1[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    ],
    author: [
      /<span[^>]+itemprop=["']author["'][^>]*>([\s\S]*?)<\/span>/i,
      /<a[^>]+href=["'][^"']*oneauthor[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      /作者[：:]\s*<[^>]*>([\s\S]*?)</i,
    ],
    description: [
      /<div[^>]+id=["']novelintro["'][^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]+itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/i,
    ],
    cover: [
      /<img[^>]+src=["']([^"']*novelimage[^"']*)["']/i,
      /noveldefaultimage[\s\S]{0,300}?<img[^>]+src=["']([^"']+)["']/i,
      /<img[^>]+id=["']novelimage["'][^>]*src=["']([^"']+)["']/i,
    ],
    category: [/文章类型[：:]\s*<?[^>]*>?\s*([^<\n]{1,20})/i],
    words: [/总字数[：:][\s\S]{0,80}/i, /字数[：:][\s\S]{0,40}/i],
  },

  "qidian.com": {
    title: [
      /<h1[^>]*>[\s\S]*?<em[^>]*>([\s\S]*?)<\/em>/i,
      /"bookName"\s*:\s*"([^"]+)"/i,
      /<h1[^>]+class=["'][^"']*book-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    ],
    author: [
      /<a[^>]+class=["'][^"']*writer[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      /"authorName"\s*:\s*"([^"]+)"/i,
      /<span[^>]+class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    ],
    description: [
      /<p[^>]+class=["'][^"']*intro[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
      /<div[^>]+class=["'][^"']*book-intro[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /<content[^>]*>([\s\S]*?)<\/content>/i,
    ],
    cover: [
      /<img[^>]+id=["']bookImg["'][^>]*src=["']([^"']+)["']/i,
      /["'](https?:)?\/\/bookcover\.yuewen\.com\/[^"']+["']/i,
      /<div[^>]+class=["'][^"']*book-img[^"']*["'][\s\S]{0,200}?<img[^>]+src=["']([^"']+)["']/i,
    ],
    category: [/<a[^>]+class=["'][^"']*(?:go-sub-type|book-type)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i],
    words: [/<em[^>]*>([\d.]+)<\/em>\s*<cite>万字<\/cite>/i, /([\d.]+)\s*万字/i],
  },

  "fanqienovel.com": {
    title: [
      /<h1[^>]+class=["'][^"']*info-name[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
      /<div[^>]+class=["'][^"']*info-name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /"bookName"\s*:\s*"([^"]+)"/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    ],
    author: [
      /<span[^>]+class=["'][^"']*author-name-text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      /"author"\s*:\s*"([^"]+)"/i,
      /<div[^>]+class=["'][^"']*author-name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ],
    description: [
      /<div[^>]+class=["'][^"']*page-abstract-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /"abstract"\s*:\s*"([^"]+)"/i,
      /<div[^>]+class=["'][^"']*book-abstract[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ],
    cover: [
      /<img[^>]+class=["'][^"']*(?:cover|book-img)[^"']*["'][^>]*src=["']([^"']+)["']/i,
      /"thumbUrl"\s*:\s*"([^"]+)"/i,
      /["'](https?:)?\/\/[^"']*novel-pic[^"']+["']/i,
    ],
    category: [/"category"\s*:\s*"([^"]+)"/i],
    words: [/"wordNumber"\s*:\s*"?(\d+)"?/i, /([\d.]+)\s*万字/i],
  },
};

/* =====================================================
   对外：抓 + 解析
===================================================== */

export async function importBook(url) {
  const site = siteOf(url);
  if (!site) {
    throw Object.assign(new Error("只支持晋江 / 起点 / 番茄的作品链接"), { code: 400 });
  }

  const page = await fetchPage(url);
  if (!page.ok) {
    throw Object.assign(new Error("目标站返回 " + page.status + "，可能被拦或链接失效"), {
      code: 502,
      status: page.status,
    });
  }

  const data = parseBook(page.html, page.finalUrl || url);
  const missing = ["title", "author", "description", "coverUrl"].filter(function (key) {
    return !data[key];
  });

  return {
    site: site.name,
    charset: page.charset,
    garbled: page.garbled,
    missing: missing,
    data: data,
  };
}
