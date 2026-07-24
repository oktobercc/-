/* =====================================================
   页间集 · EPUB 元数据读取（零依赖）

   不依赖 epub.js / jszip：自带一个精简 ZIP 读取器
   （EOCD → 中央目录 → 局部头 → DecompressionStream 解压），
   只解压真正需要的 3~4 个文件，几十 MB 的书也是秒开。

   对外只暴露：
     window.readEpubMetaLocal(file)  →  {
       title, author, authors, publisher, description,
       language, isbn, pubdate, subjects, series, seriesIndex,
       coverBlob, coverMime
     }
===================================================== */
(function () {
  "use strict";

  var NS_DC = "http://purl.org/dc/elements/1.1/";

  /* =====================================================
     一、精简 ZIP 读取器
  ===================================================== */

  var SIG_EOCD = 0x06054b50; // 中央目录结束记录
  var SIG_EOCD64_LOC = 0x07064b50; // ZIP64 定位记录
  var SIG_CEN = 0x02014b50; // 中央目录项
  var SIG_LOC = 0x04034b50; // 局部文件头

  function findSignature(bytes, sig, from) {
    var b0 = sig & 0xff,
      b1 = (sig >>> 8) & 0xff,
      b2 = (sig >>> 16) & 0xff,
      b3 = (sig >>> 24) & 0xff;
    for (var i = from; i >= 0; i--) {
      if (bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) {
        return i;
      }
    }
    return -1;
  }

  async function openZip(blob) {
    var size = blob.size;
    if (!size) throw new Error("文件是空的");

    // EOCD 在文件末尾，最多再往前 64KB（注释区上限）
    var tailLen = Math.min(size, 66 * 1024);
    var tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    var p = findSignature(tail, SIG_EOCD, tail.length - 22);
    if (p < 0) throw new Error("不是合法的 ZIP / EPUB 文件");

    var dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    var count = dv.getUint16(p + 10, true);
    var cdSize = dv.getUint32(p + 12, true);
    var cdOffset = dv.getUint32(p + 16, true);

    // ZIP64（超大包才会用到，顺手兼容）
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
      var q = findSignature(tail, SIG_EOCD64_LOC, p - 20);
      if (q >= 0) {
        var z64Offset = Number(dv.getBigUint64(q + 8, true));
        var z64 = new DataView(await blob.slice(z64Offset, z64Offset + 56).arrayBuffer());
        count = Number(z64.getBigUint64(32, true));
        cdSize = Number(z64.getBigUint64(40, true));
        cdOffset = Number(z64.getBigUint64(48, true));
      }
    }

    var cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    var decoder = new TextDecoder("utf-8");
    var entries = [];
    var o = 0;

    for (var i = 0; i < count && o + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(o, true) !== SIG_CEN) break;

      var method = cd.getUint16(o + 10, true);
      var compSize = cd.getUint32(o + 20, true);
      var rawSize = cd.getUint32(o + 24, true);
      var nameLen = cd.getUint16(o + 28, true);
      var extraLen = cd.getUint16(o + 30, true);
      var commentLen = cd.getUint16(o + 32, true);
      var localOffset = cd.getUint32(o + 42, true);
      var name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nameLen));

      // ZIP64 扩展字段里补齐被写成 0xffffffff 的那几个值
      if (compSize === 0xffffffff || rawSize === 0xffffffff || localOffset === 0xffffffff) {
        var ex = o + 46 + nameLen;
        var exEnd = ex + extraLen;
        while (ex + 4 <= exEnd) {
          var id = cd.getUint16(ex, true);
          var len = cd.getUint16(ex + 2, true);
          var at = ex + 4;
          if (id === 0x0001) {
            if (rawSize === 0xffffffff) { rawSize = Number(cd.getBigUint64(at, true)); at += 8; }
            if (compSize === 0xffffffff) { compSize = Number(cd.getBigUint64(at, true)); at += 8; }
            if (localOffset === 0xffffffff) { localOffset = Number(cd.getBigUint64(at, true)); }
            break;
          }
          ex += 4 + len;
        }
      }

      entries.push({ name: name, method: method, compSize: compSize, rawSize: rawSize, offset: localOffset });
      o += 46 + nameLen + extraLen + commentLen;
    }

    if (!entries.length) throw new Error("ZIP 中央目录是空的");

    // 建索引：原名 + 小写 + 解码后的小写，兼容打包不规范的书
    var index = {};
    entries.forEach(function (e) {
      index[e.name] = e;
      var lower = e.name.toLowerCase();
      if (!(lower in index)) index[lower] = e;
      var decoded = safeDecode(lower);
      if (!(decoded in index)) index[decoded] = e;
    });

    return {
      blob: blob,
      entries: entries,
      find: function (path) {
        return index[path] || index[path.toLowerCase()] || index[safeDecode(path).toLowerCase()] || null;
      },
      read: function (entry) {
        return readEntry(blob, entry);
      },
    };
  }

  async function readEntry(blob, entry) {
    var head = new DataView(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== SIG_LOC) throw new Error("ZIP 局部文件头损坏：" + entry.name);

    var start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    var slice = blob.slice(start, start + entry.compSize);

    if (entry.method === 0) return new Uint8Array(await slice.arrayBuffer()); // 未压缩
    if (entry.method !== 8) throw new Error("不支持的压缩方式：" + entry.method);

    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持 DecompressionStream，无法解压 EPUB");
    }
    var stream = slice.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* =====================================================
     二、小工具
  ===================================================== */

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function parseXml(text, type) {
    return new DOMParser().parseFromString(text, type || "application/xml");
  }

  var utf8 = new TextDecoder("utf-8");

  function normalizePath(path) {
    var out = [];
    path.split("/").forEach(function (seg) {
      if (!seg || seg === ".") return;
      if (seg === "..") out.pop();
      else out.push(seg);
    });
    return out.join("/");
  }

  function resolvePath(dir, href) {
    return normalizePath(dir + safeDecode(String(href).split("#")[0]));
  }

  /** 取 dc:xxx 节点，命名空间失效时按 localName 兜底 */
  function dcNodes(scope, tag) {
    var nodes = [];
    if (scope.getElementsByTagNameNS) {
      nodes = Array.prototype.slice.call(scope.getElementsByTagNameNS(NS_DC, tag));
    }
    if (!nodes.length) {
      nodes = Array.prototype.slice.call(scope.getElementsByTagName("*")).filter(function (n) {
        return (n.localName || n.nodeName).split(":").pop() === tag;
      });
    }
    return nodes;
  }

  function dcTexts(scope, tag) {
    return dcNodes(scope, tag)
      .map(function (n) {
        return (n.textContent || "").trim();
      })
      .filter(Boolean);
  }

  function dcText(scope, tag) {
    return dcTexts(scope, tag)[0] || "";
  }

  /** 简介里常带 HTML 标签和实体，转成纯文本，段落保留空行 */
  function toPlainText(html) {
    if (!html) return "";
    if (!/[<&]/.test(html)) return html.trim();

    var doc = parseXml("<!DOCTYPE html><body>" + html + "</body>", "text/html");
    Array.prototype.slice.call(doc.body.querySelectorAll("p, br, div, li")).forEach(function (el) {
      el.insertAdjacentText("beforebegin", "\n");
    });
    return (doc.body.textContent || "")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .join("\n")
      .trim();
  }

  var MIME_BY_EXT = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };

  function guessMime(path) {
    return MIME_BY_EXT[String(path).split(".").pop().toLowerCase()] || "image/jpeg";
  }

  /* =====================================================
     三、主流程
  ===================================================== */

  async function readEpubMetaLocal(file) {
    var zip = await openZip(file);

    /* 1. META-INF/container.xml → OPF 路径 */
    var containerEntry = zip.find("META-INF/container.xml");
    if (!containerEntry) throw new Error("不是合法的 EPUB：缺少 META-INF/container.xml");

    var container = parseXml(utf8.decode(await zip.read(containerEntry)));
    var rootfile = container.getElementsByTagName("rootfile")[0];
    var opfPath = normalizePath((rootfile && rootfile.getAttribute("full-path")) || "");
    if (!opfPath) throw new Error("不是合法的 EPUB：container.xml 里没有 rootfile");

    var opfDir = opfPath.indexOf("/") >= 0 ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    /* 2. 解析 OPF */
    var opfEntry = zip.find(opfPath);
    if (!opfEntry) throw new Error("不是合法的 EPUB：找不到 " + opfPath);

    var opf = parseXml(utf8.decode(await zip.read(opfEntry)));
    var metadata = opf.getElementsByTagName("metadata")[0] || opf;

    /* 3. dc 元数据 */
    var authors = pickAuthors(metadata);
    var meta = {
      title: dcText(metadata, "title"),
      authors: authors,
      author: authors.join("、"),
      publisher: dcText(metadata, "publisher"),
      description: toPlainText(dcText(metadata, "description")),
      language: dcText(metadata, "language"),
      isbn: pickIsbn(metadata),
      pubdate: pickDate(metadata),
      subjects: dcTexts(metadata, "subject"),
      series: metaContent(metadata, "calibre:series"),
      seriesIndex: metaContent(metadata, "calibre:series_index"),
      coverBlob: null,
      coverMime: "",
    };

    if (!meta.title) meta.title = file.name ? file.name.replace(/\.[^/.]+$/, "") : "";

    /* 4. 封面 */
    try {
      var cover = await findCover(zip, opf, opfDir);
      if (cover) {
        var entry = zip.find(cover.path);
        if (entry) {
          var bytes = await zip.read(entry);
          meta.coverMime = cover.mime || guessMime(cover.path);
          meta.coverBlob = new Blob([bytes], { type: meta.coverMime });
        }
      }
    } catch (err) {
      console.warn("封面提取失败", err);
    }

    return meta;
  }

  /* ---------- 作者：EPUB3 用 meta refines，EPUB2 用 opf:role ---------- */
  function pickAuthors(metadata) {
    var nodes = dcNodes(metadata, "creator");
    if (!nodes.length) return [];

    var metas = Array.prototype.slice.call(metadata.getElementsByTagName("meta"));

    function roleOf(node) {
      var attr = node.getAttribute("opf:role");
      if (!attr && node.getAttributeNS) {
        attr = node.getAttributeNS("http://www.idpf.org/2007/opf", "role");
      }
      if (attr) return attr;

      var id = node.getAttribute("id");
      if (!id) return "";
      var refine = metas.filter(function (m) {
        return m.getAttribute("refines") === "#" + id && m.getAttribute("property") === "role";
      })[0];
      return refine ? (refine.textContent || "").trim() : "";
    }

    var named = nodes
      .map(function (n) {
        return { name: (n.textContent || "").trim(), role: roleOf(n) };
      })
      .filter(function (x) {
        return x.name;
      });

    // 标了 aut 的只留 aut（把译者、编者剔掉），没标就全要
    var onlyAuthors = named.filter(function (x) {
      return x.role === "aut";
    });

    return (onlyAuthors.length ? onlyAuthors : named).map(function (x) {
      return x.name;
    });
  }

  function pickIsbn(metadata) {
    var ids = dcTexts(metadata, "identifier");
    var hit =
      ids.filter(function (v) {
        return /isbn/i.test(v);
      })[0] ||
      ids.filter(function (v) {
        return /^[\d-]{10,17}$/.test(v.trim());
      })[0];
    return hit ? hit.replace(/^urn:isbn:/i, "").trim() : "";
  }

  function pickDate(metadata) {
    var raw =
      dcTexts(metadata, "date").filter(function (v) {
        return /\d{4}/.test(v);
      })[0] ||
      metaContent(metadata, "dcterms:issued") ||
      "";
    var m = raw.match(/\d{4}(-\d{2}(-\d{2})?)?/);
    return m ? m[0] : "";
  }

  /** 读 <meta name="x" content="y"> 或 EPUB3 的 <meta property="x">y</meta> */
  function metaContent(metadata, name) {
    var metas = Array.prototype.slice.call(metadata.getElementsByTagName("meta"));
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].getAttribute("name") === name) {
        return (metas[i].getAttribute("content") || "").trim();
      }
      if (metas[i].getAttribute("property") === name && !metas[i].getAttribute("refines")) {
        return (metas[i].textContent || "").trim();
      }
    }
    return "";
  }

  /* ---------- 封面：五级兜底 ---------- */
  async function findCover(zip, opf, opfDir) {
    var items = Array.prototype.slice.call(opf.getElementsByTagName("item")).map(function (it) {
      return {
        id: it.getAttribute("id") || "",
        href: it.getAttribute("href") || "",
        mime: it.getAttribute("media-type") || "",
        props: it.getAttribute("properties") || "",
      };
    });

    function isImage(it) {
      return it.mime.indexOf("image/") === 0 || /\.(jpe?g|png|gif|webp)$/i.test(it.href);
    }
    function out(it) {
      return it && it.href ? { path: resolvePath(opfDir, it.href), mime: it.mime } : null;
    }
    function byId(id) {
      return items.filter(function (it) {
        return it.id === id;
      })[0];
    }

    // ① EPUB2 惯例：<meta name="cover" content="封面项 id">
    var metadata = opf.getElementsByTagName("metadata")[0] || opf;
    var coverItem = byId(metaContent(metadata, "cover"));
    if (coverItem && isImage(coverItem)) return out(coverItem);

    // ② EPUB3 规范：properties="cover-image"
    var byProps = items.filter(function (it) {
      return it.props.split(/\s+/).indexOf("cover-image") >= 0;
    })[0];
    if (byProps) return out(byProps);

    // ③ id 或文件名里带 cover 的图片
    var byName = items.filter(function (it) {
      return isImage(it) && /cover|封面/i.test(it.id + " " + it.href);
    })[0];
    if (byName) return out(byName);

    // ④ guide 指的封面页 / meta 指的封面页 → 进 xhtml 抠 <img> 或 <svg><image>
    var ref = Array.prototype.slice.call(opf.getElementsByTagName("reference")).filter(function (r) {
      return (r.getAttribute("type") || "").toLowerCase() === "cover";
    })[0];

    var pagePath = "";
    if (ref && ref.getAttribute("href")) pagePath = resolvePath(opfDir, ref.getAttribute("href"));
    else if (coverItem && !isImage(coverItem)) pagePath = resolvePath(opfDir, coverItem.href);

    if (pagePath) {
      var pageEntry = zip.find(pagePath);
      if (pageEntry) {
        var doc = parseXml(utf8.decode(await zip.read(pageEntry)), "text/html");
        var el = null;
        try {
          el = doc.querySelector("img[src], image[*|href], image[href]"); // 命名空间选择器个别浏览器会抛
        } catch (e) {
          el = null;
        }
        if (!el) el = doc.querySelector("img[src]") || doc.getElementsByTagName("image")[0] || null;
        var src =
          (el && (el.getAttribute("src") || el.getAttribute("xlink:href") || el.getAttribute("href"))) || "";
        if (src) {
          var dir = pagePath.indexOf("/") >= 0 ? pagePath.slice(0, pagePath.lastIndexOf("/") + 1) : "";
          var path = resolvePath(dir, src);
          return { path: path, mime: guessMime(path) };
        }
      }
    }

    // ⑤ 实在没有，用 manifest 里第一张图
    return out(
      items.filter(function (it) {
        return isImage(it);
      })[0]
    );
  }

  window.readEpubMetaLocal = readEpubMetaLocal;
})();
