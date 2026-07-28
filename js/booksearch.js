/* =====================================================
   页间集 · 按书名 / 作者 / ISBN 找书

   两条路：
     纸质书 —— 豆瓣 / Google Books / OpenLibrary，
               配了后端走后端（国内网络也能通），没配就浏览器直接查
     小说站 —— 晋江 / 起点 / 番茄的站内搜索，必须走后端，
               浏览器直连这些站会被跨域拦死

   搜到之后点一条就填表：小说站会再抓一次作品页拿全简介和封面，
   纸质书的信息搜索结果里就有，直接填。
===================================================== */

let searchResults = [];

/** 自带一个转义，别依赖 app.js —— 添加页不加载它 */
function escapeText(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function searchStatus(text) {
  const box = document.getElementById("search-status");
  if (box) box.textContent = text || "";
}

async function searchBooksByKeyword() {
  const keyword = document.getElementById("search-q").value.trim();
  const site = document.getElementById("search-site").value;

  if (!keyword) {
    searchStatus("先填书名、作者或 ISBN");
    return;
  }

  const list = document.getElementById("search-results");
  list.innerHTML = "";
  searchResults = [];
  searchStatus("正在找…");

  try {
    const result = await runSearch(keyword, site);
    searchResults = result.results || [];

    if (!searchResults.length) {
      searchStatus(
        "没找到。" +
          (result.tried && result.tried.length ? "（" + result.tried.join("；") + "）" : "") +
          (site ? "换个关键词，或直接粘贴作品链接" : "换个关键词，或试试 ISBN")
      );
      return;
    }

    renderSearchResults(searchResults);
    searchStatus("找到 " + searchResults.length + " 条" + (result.source ? "（来自" + result.source + "）" : "") + "，点一条填进表单");
  } catch (err) {
    console.warn(err);
    searchStatus(err.message || String(err));
  }
}

async function runSearch(keyword, site) {
  // 配了后端一律走后端：小说站非它不可，纸质书走后端也更稳（豆瓣、Google 都由 Worker 去请求）
  if (window.CloudSync && CloudSync.configured()) {
    return await CloudSync.searchBooks(keyword, site);
  }

  if (site) {
    throw new Error("搜小说站需要先连上后端（关于我 → 云同步），否则浏览器会被跨域拦住");
  }

  return await searchPrintedBooksDirect(keyword);
}

/** 没有后端时，浏览器直接查两个允许跨域的公开接口 */
async function searchPrintedBooksDirect(keyword) {
  const isIsbn = /^[\d\-\s]{10,17}[\dXx]?$/.test(keyword);
  const clean = keyword.replace(/[^\dXx]/g, "");
  const tried = [];

  try {
    const query = isIsbn ? "isbn:" + clean : keyword;
    const response = await fetch(
      "https://www.googleapis.com/books/v1/volumes?maxResults=12&q=" + encodeURIComponent(query)
    );
    if (!response.ok) throw new Error("返回 " + response.status);

    const data = await response.json();
    const results = (data.items || []).map(function (item) {
      const info = item.volumeInfo || {};
      const ids = info.industryIdentifiers || [];
      return {
        title: info.title + (info.subtitle ? "：" + info.subtitle : ""),
        author: (info.authors || []).join("、"),
        publisher: info.publisher || "",
        year: (info.publishedDate || "").slice(0, 4),
        description: info.description || "",
        isbn: ((ids.find((x) => x.type === "ISBN_13") || ids[0] || {}).identifier) || "",
        coverUrl: ((info.imageLinks || {}).thumbnail || "").replace(/^http:/, "https:"),
        source: "Google Books",
      };
    });
    if (results.length) return { source: "Google Books", results: results };
    tried.push("Google Books：没结果");
  } catch (e) {
    tried.push("Google Books：" + e.message);
  }

  try {
    const url = isIsbn
      ? "https://openlibrary.org/search.json?limit=12&isbn=" + clean
      : "https://openlibrary.org/search.json?limit=12&q=" + encodeURIComponent(keyword);
    const response = await fetch(url);
    if (!response.ok) throw new Error("返回 " + response.status);

    const data = await response.json();
    const results = (data.docs || []).map(function (doc) {
      return {
        title: doc.title || "",
        author: (doc.author_name || []).join("、"),
        publisher: (doc.publisher || [])[0] || "",
        year: doc.first_publish_year || "",
        isbn: (doc.isbn || [])[0] || "",
        coverUrl: doc.cover_i ? "https://covers.openlibrary.org/b/id/" + doc.cover_i + "-M.jpg" : "",
        source: "OpenLibrary",
      };
    });
    if (results.length) return { source: "OpenLibrary", results: results };
    tried.push("OpenLibrary：没结果");
  } catch (e) {
    tried.push("OpenLibrary：" + e.message);
  }

  return { source: "", results: [], tried: tried };
}

function renderSearchResults(results) {
  const list = document.getElementById("search-results");
  list.innerHTML = "";

  results.forEach(function (item, index) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "search-hit";
    row.onclick = function () {
      useSearchResult(index);
    };

    const meta = [item.author, item.publisher, item.year].filter(Boolean).join(" · ");
    row.innerHTML =
      (item.coverUrl
        ? '<img class="search-hit-cover" src="' + escapeText(item.coverUrl) + '" alt="" loading="lazy" />'
        : '<span class="search-hit-cover empty"></span>') +
      '<span class="search-hit-text">' +
      '<span class="search-hit-title">' + escapeText(item.title) + "</span>" +
      '<span class="search-hit-meta">' + escapeText(meta || item.source || "") + "</span>" +
      "</span>";

    list.appendChild(row);
  });
}

async function useSearchResult(index) {
  const item = searchResults[index];
  if (!item) return;

  // 小说站：拿着链接再抓一次作品页，简介和封面才全
  if (item.url && /jjwxc|qidian|fanqienovel/.test(item.url)) {
    document.getElementById("import-url").value = item.url;
    searchStatus("正在读取《" + item.title + "》…");
    await importFromUrl();
    searchStatus("已填入《" + item.title + "》，请核对");
    return;
  }

  // 纸质书：搜索结果本身就够填了
  applyMeta({
    title: item.title,
    author: item.author,
    publisher: item.publisher,
    description: item.description,
  });

  if (item.url) document.getElementById("f-url").value = item.url;
  if (item.source) document.getElementById("f-source").value = pickOrCreate("source", item.source);

  if (item.coverUrl && !coverBlob) {
    try {
      let blob = null;
      if (window.CloudSync && CloudSync.configured()) blob = await CloudSync.proxyImage(item.coverUrl);
      if (!blob) blob = await fetchCoverBlob(item.coverUrl, item.url || "");

      if (blob) {
        lastCoverSource = blob;
        try {
          applyCropped(await autoCrop3x4(blob));
        } catch (e) {
          openCropper(blob, applyCropped);
        }
      }
    } catch (e) {
      console.warn("封面取不到", e);
    }
  }

  searchStatus("已填入《" + item.title + "》，请核对" + (item.isbn ? "（ISBN " + item.isbn + "）" : ""));
}

/** 回车即搜 */
document.addEventListener("DOMContentLoaded", function () {
  const input = document.getElementById("search-q");
  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        searchBooksByKeyword();
      }
    });
  }
});

window.searchBooksByKeyword = searchBooksByKeyword;
window.useSearchResult = useSearchResult;
