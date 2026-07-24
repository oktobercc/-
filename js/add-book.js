/* =====================================================
   页间集 · 添加 / 编辑书籍
   add-book.html            → 新建
   add-book.html?id=123     → 编辑已有书籍
===================================================== */

let editingId = null;
let coverBlob = null;      // 新选的封面（已裁剪）
let coverKept = false;     // 编辑模式下沿用原封面
let lastCoverSource = null; // 原始图片，供「重新裁剪」使用

let attachments = [];      // { kind, name, url, ext, size, blob?, assetId? }
let excerpts = [];         // { id, text, images:[{ name, blob?, assetId? }] }
let selectedTags = [];
let rating = 0;            // 0~5，支持小数
let currentStatus = "在读";

/* ===============================
   初始化
================================ */
document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(location.search);
  editingId = params.get("id");

  renderOptionSelects();
  renderTagPicker();
  renderHearts();
  bindStatusPicker();

  if (editingId) {
    document.getElementById("page-heading").innerText = "编辑书籍";
    document.getElementById("save-btn").innerText = "保存修改";
    loadExisting(editingId);
  } else {
    setStatus("在读");
  }

  renderAttachments();
  renderExcerpts();
});

function goBack() {
  if (editingId) {
    location.href = "book-detail.html?id=" + encodeURIComponent(editingId);
  } else {
    location.href = "index.html";
  }
}

/* ===============================
   选项：来源 / 类型 / 标签
================================ */
function renderOptionSelects() {
  const options = getOptions();
  fillSelect("f-source", options.source);
  fillSelect("f-category", options.category);
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = '<option value="">未选择</option>';

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.innerText = value;
    select.appendChild(option);
  });

  if (current) select.value = current;
}

function renderTagPicker() {
  const box = document.getElementById("tag-picker");
  const options = getOptions();

  box.innerHTML = "";
  options.tags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "tag-chip" + (selectedTags.includes(tag) ? " on" : "");
    chip.innerText = tag;
    chip.onclick = function () {
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter((t) => t !== tag);
      } else {
        selectedTags.push(tag);
      }
      renderTagPicker();
    };
    box.appendChild(chip);
  });
}

function createOption(kind) {
  const labels = { source: "来源", category: "作品类型", tags: "标签" };
  const value = prompt("新建" + labels[kind]);
  if (!value) return;

  addOption(kind, value.trim());

  if (kind === "tags") {
    if (!selectedTags.includes(value.trim())) selectedTags.push(value.trim());
    renderTagPicker();
  } else {
    renderOptionSelects();
    document.getElementById(kind === "source" ? "f-source" : "f-category").value = value.trim();
  }
}

/* ===============================
   封面
================================ */
function pickCover() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = function (e) {
    const file = e.target.files[0];
    if (!file) return;
    lastCoverSource = file;
    openCropper(file, applyCropped);
  };
  input.click();
}

function recropCover() {
  if (!lastCoverSource) {
    alert("没有可重新裁剪的原图，请重新选择图片");
    return;
  }
  openCropper(lastCoverSource, applyCropped);
}

function applyCropped(blob) {
  coverBlob = blob;
  coverKept = false;
  showCoverPreview(URL.createObjectURL(blob));
  document.getElementById("recrop-btn").disabled = !lastCoverSource;
}

function showCoverPreview(url) {
  const img = document.getElementById("cover-preview");
  const empty = document.getElementById("cover-empty");

  if (!url) {
    img.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  img.src = url;
  img.classList.remove("hidden");
  empty.classList.add("hidden");
}

function clearCover() {
  coverBlob = null;
  coverKept = false;
  lastCoverSource = null;
  document.getElementById("recrop-btn").disabled = true;
  showCoverPreview(null);
}

/* ===============================
   快速导入：本地文件
================================ */
function pickMetaFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".epub,.txt";
  input.onchange = async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    setImportStatus("正在读取 " + file.name + " …");
    try {
      const meta = await readMetaFromFile(file);
      applyMeta(meta);

      // 顺手把这个文件也存成附件
      addFileAttachment(file, true);
      setImportStatus(meta.note || describeMeta(meta) + "（文件已加入附件）");
    } catch (err) {
      console.error(err);
      setImportStatus("读取失败：" + err.message);
    }
  };
  input.click();
}

/* ===============================
   快速导入：网页
================================ */
async function importFromUrl() {
  const url = document.getElementById("import-url").value.trim();
  if (!url) {
    setImportStatus("先粘贴一个作品链接");
    return;
  }

  const site = detectSite(url);
  setImportStatus("正在读取" + (site || "网页") + " …");

  // 配了后端就走后端抓：浏览器直连这些站会被跨域拦死
  if (window.CloudSync && CloudSync.configured()) {
    let result = null;
    try {
      result = await CloudSync.importBook(url);
    } catch (err) {
      console.warn(err);
      setImportStatus("后端抓取失败：" + err.message + "，改试浏览器直连…");
    }

    // 抓到了就以它为准。填表和封面各自兜底，
    // 封面出问题不该让已经抓到的书名简介白抓一次
    if (result) {
      await applyWebData(result.data || {}, url);

      const missing = (result.missing || []).length;
      setImportStatus(
        "已从" + (result.site || "网页") + "读取" +
        (missing ? "，有 " + missing + " 项没抓到，手动补一下" : "，请核对") +
        (result.viaBrowser ? "（编码由浏览器解）" : "")
      );
      return;
    }
  }

  try {
    const html = await fetchPage(url);
    const data = parseBookPage(html, url);
    await applyWebData(data, url);
    setImportStatus("导入完成，请核对信息");
  } catch (err) {
    console.warn(err);
    document.getElementById("f-url").value = url;
    if (site) document.getElementById("f-source").value = pickOrCreate("source", site);
    setImportStatus("网站拒绝了跨域读取。用「粘贴网页源码导入」，或手动填写。");
    document.getElementById("html-paste").classList.remove("hidden");
  }
}

function toggleHtmlPaste() {
  document.getElementById("html-paste").classList.toggle("hidden");
}

async function importFromHtml() {
  const html = document.getElementById("html-source").value.trim();
  const url = document.getElementById("import-url").value.trim();

  if (!html) {
    setImportStatus("先把网页源码粘进来");
    return;
  }

  try {
    const data = parseBookPage(html, url);
    await applyWebData(data, url);
    setImportStatus("解析完成，请核对信息");
  } catch (err) {
    setImportStatus("解析失败：" + err.message);
  }
}

async function applyWebData(data, url) {
  applyMeta({
    title: data.title,
    author: data.author,
    description: data.description,
    publisher: data.publisher,
  });

  if (url) document.getElementById("f-url").value = url;
  if (data.words) document.getElementById("f-words").value = data.words;
  if (data.source) document.getElementById("f-source").value = pickOrCreate("source", data.source);

  if (data.coverUrl && !coverBlob) {
    try {
      // 三站封面图基本都带防盗链，浏览器直连会被拒；
      // 配了后端就让 Worker 带着 Referer 代取，取不到再退回浏览器直连
      let blob = null;
      if (window.CloudSync && CloudSync.configured()) {
        blob = await CloudSync.proxyImage(data.coverUrl);
      }
      if (!blob) blob = await fetchCoverBlob(data.coverUrl, url);

      if (!blob) {
        setImportStatus("封面图拿不到（跨域或对方拒绝），请手动上传封面");
      } else {
        lastCoverSource = blob;
        if (typeof autoCrop3x4 === "function") {
          try {
            applyCropped(await autoCrop3x4(blob));
          } catch (e) {
            openCropper(blob, applyCropped);
          }
        } else {
          openCropper(blob, applyCropped);
        }
      }
    } catch (err) {
      console.warn("封面处理失败", err);
      setImportStatus("封面没弄进来，其余信息已填好，封面手动传一下");
    }
  }
}

function pickOrCreate(kind, value) {
  addOption(kind, value);
  renderOptionSelects();
  return value;
}

function applyMeta(meta) {
  if (!meta) return;
  setIfEmpty("f-title", meta.title);
  setIfEmpty("f-author", meta.author);
  setIfEmpty("f-publisher", meta.publisher);
  setIfEmpty("f-description", meta.description);

  if (meta.coverBlob && !coverBlob) {
    lastCoverSource = meta.coverBlob;
    // 自动居中裁成 3:4 直接填进封面框；裁不了才退回手动裁剪窗
    if (typeof autoCrop3x4 === "function") {
      autoCrop3x4(meta.coverBlob)
        .then(applyCropped)
        .catch(function () {
          openCropper(meta.coverBlob, applyCropped);
        });
    } else {
      openCropper(meta.coverBlob, applyCropped);
    }
  }
}

/** 读完之后告诉用户到底填进去了哪几项 */
function describeMeta(meta) {
  if (!meta) return "没读到可用信息";

  const filled = [];
  if (meta.title) filled.push("书名");
  if (meta.author) filled.push("作者");
  if (meta.publisher) filled.push("出版社");
  if (meta.description) filled.push("简介");
  if (meta.coverBlob) filled.push("封面");

  if (!filled.length) return "这本书里没写元数据，请手动填";
  return "已读取：" + filled.join(" / ") + "，请核对";
}

function setIfEmpty(id, value) {
  if (!value) return;
  const el = document.getElementById(id);
  if (el && !el.value.trim()) el.value = value;
}

function setImportStatus(text) {
  document.getElementById("import-status").textContent = text || "";
}

/* ===============================
   附件
================================ */
const ATTACH_ACCEPT = ".azw3,.txt,.mobi,.epub,.pdf,.doc,.docx,.zip";

function pickAttachments() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ATTACH_ACCEPT;
  input.onchange = function (e) {
    Array.from(e.target.files).forEach(addFileAttachment);
  };
  input.click();
}

function addFileAttachment(file, skipAutoRead) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const exists = attachments.some((a) => a.kind === "file" && a.name === file.name && a.size === file.size);
  if (exists) return;

  attachments.push({
    kind: "file",
    name: file.name,
    ext: ext,
    size: file.size,
    mime: file.type,
    blob: file,
  });
  renderAttachments();

  // 直接从「添加文件」丢进来的 EPUB，也顺手读一次元数据
  if (!skipAutoRead && ext === "epub") autoReadEpub(file);
}

/** 附件里出现 EPUB 时自动读元数据。只填空着的字段，不覆盖已填内容 */
async function autoReadEpub(file) {
  setImportStatus("正在读取 " + file.name + " …");
  try {
    const meta = await readMetaFromFile(file);
    applyMeta(meta);
    setImportStatus(describeMeta(meta));
  } catch (err) {
    console.warn(err);
    setImportStatus("这个 EPUB 读不出元数据：" + err.message);
  }
}

function addLinkAttachment() {
  const url = prompt("附件链接");
  if (!url) return;
  const name = prompt("给这个链接起个名字", url.slice(0, 40)) || url;

  attachments.push({ kind: "link", name: name, url: url });
  renderAttachments();
}

function removeAttachment(index) {
  attachments.splice(index, 1);
  renderAttachments();
}

function renderAttachments() {
  const list = document.getElementById("attach-list");
  list.innerHTML = "";

  if (attachments.length === 0) {
    list.innerHTML = '<p class="empty-line">还没有附件</p>';
    return;
  }

  attachments.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "attach-item";
    row.innerHTML = `
      <span class="attach-kind">${item.kind === "link" ? "链接" : (item.ext || "文件").toUpperCase()}</span>
      <span class="attach-name">${escapeHtml(item.name)}</span>
      <span class="attach-size">${item.kind === "link" ? escapeHtml(item.url || "") : formatSize(item.size)}</span>
      <button class="mini-btn danger" data-index="${index}">移除</button>
    `;
    row.querySelector("button").onclick = () => removeAttachment(index);
    list.appendChild(row);
  });
}

/* ===============================
   阅读状态联动
================================ */
function bindStatusPicker() {
  document.querySelectorAll(".status-chip").forEach((chip) => {
    chip.addEventListener("click", () => setStatus(chip.getAttribute("data-status")));
  });
}

function setStatus(status) {
  currentStatus = status;

  document.querySelectorAll(".status-chip").forEach((chip) => {
    chip.classList.toggle("on", chip.getAttribute("data-status") === status);
  });

  const show = {
    "cond-start": status === "在读" || status === "暂停" || status === "已读",
    "cond-end": status === "已读",
    "cond-rating": status === "已读",
    "cond-review": status === "已读" || status === "弃读",
    "cond-excerpt": status === "已读",
  };

  Object.keys(show).forEach((id) => {
    document.getElementById(id).classList.toggle("hidden", !show[id]);
  });
}

/* ===============================
   评分（五颗爱心，可点亮任意比例）
================================ */
function renderHearts() {
  const box = document.getElementById("hearts");
  box.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const heart = document.createElement("span");
    heart.className = "heart";
    heart.innerHTML = '<span class="heart-bg">♥</span><span class="heart-fill"><span>♥</span></span>';
    box.appendChild(heart);
  }

  bindRating(box);
  paintHearts();
}

/**
 * 打分交互统一走 pointer 事件：鼠标和手指是同一套逻辑。
 * 原来只监听 click / mousemove，手机上触屏不产生 mousemove，
 * 轻微滑动还会让浏览器把 click 吞掉，所以点了没反应。
 * 现在按下即打分，按住左右拖还能微调到半颗心。
 */
function bindRating(box) {
  if (box.dataset.bound === "1") return;
  box.dataset.bound = "1";

  let dragging = false;

  // 按 x 坐标换算成 0~5 分（每 0.05 一档）
  function valueAt(clientX) {
    const hearts = box.querySelectorAll(".heart");
    if (!hearts.length) return 0;

    const first = hearts[0].getBoundingClientRect();
    const last = hearts[hearts.length - 1].getBoundingClientRect();
    if (clientX <= first.left) return 0.1;
    if (clientX >= last.right) return 5;

    for (let i = 0; i < hearts.length; i++) {
      const rect = hearts[i].getBoundingClientRect();
      if (clientX < rect.right || i === hearts.length - 1) {
        let fraction = (clientX - rect.left) / rect.width;
        fraction = Math.max(0.1, Math.min(1, Math.round(fraction * 20) / 20));
        return i + fraction;
      }
    }
    return 5;
  }

  function commit(clientX) {
    rating = valueAt(clientX);
    paintHearts();
  }

  box.addEventListener("pointerdown", function (e) {
    dragging = true;
    try {
      box.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 老浏览器没有指针捕获，忽略 */
    }
    commit(e.clientX);
    e.preventDefault(); // 别让触屏把这一下当成滑动或选中文字
  });

  box.addEventListener("pointermove", function (e) {
    if (dragging) {
      commit(e.clientX);
      return;
    }
    if (e.pointerType === "mouse") paintHearts(valueAt(e.clientX)); // 鼠标划过时预览
  });

  function stop() {
    dragging = false;
    paintHearts();
  }

  box.addEventListener("pointerup", stop);
  box.addEventListener("pointercancel", stop);
  box.addEventListener("pointerleave", function () {
    if (!dragging) paintHearts();
  });

  // 兜底：非常老的浏览器没有 PointerEvent
  if (!window.PointerEvent) {
    box.addEventListener("click", function (e) {
      commit(e.clientX);
    });
    box.addEventListener("touchend", function (e) {
      if (e.changedTouches && e.changedTouches[0]) {
        commit(e.changedTouches[0].clientX);
        e.preventDefault();
      }
    });
  }
}

function paintHearts(preview) {
  const value = preview === undefined ? rating : preview;
  const hearts = document.querySelectorAll("#hearts .heart");

  hearts.forEach((heart, i) => {
    const fill = heart.querySelector(".heart-fill");
    const percent = Math.max(0, Math.min(1, value - i)) * 100;
    fill.style.width = percent + "%";
  });

  const text = document.getElementById("rating-text");
  if (text && preview === undefined) {
    text.innerText = rating > 0 ? rating.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " / 5" : "未评分";
  }
}

function clearRating() {
  rating = 0;
  paintHearts();
}

/* ===============================
   书摘
================================ */
function addExcerpt(data) {
  excerpts.push(
    data || { id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: "", images: [] }
  );
  renderExcerpts();
}

function removeExcerpt(index) {
  excerpts.splice(index, 1);
  renderExcerpts();
}

function pickExcerptImages(index) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = function (e) {
    Array.from(e.target.files).forEach((file) => {
      excerpts[index].images.push({ name: file.name, blob: file, mime: file.type });
    });
    renderExcerpts();
  };
  input.click();
}

function removeExcerptImage(excerptIndex, imageIndex) {
  excerpts[excerptIndex].images.splice(imageIndex, 1);
  renderExcerpts();
}

function renderExcerpts() {
  const list = document.getElementById("excerpt-list");
  if (!list) return;

  list.innerHTML = "";
  if (excerpts.length === 0) {
    list.innerHTML = '<p class="empty-line">还没有书摘</p>';
    return;
  }

  excerpts.forEach((item, index) => {
    const box = document.createElement("div");
    box.className = "excerpt-item";

    const textarea = document.createElement("textarea");
    textarea.className = "field-input";
    textarea.rows = 3;
    textarea.placeholder = "摘录的段落";
    textarea.value = item.text || "";
    textarea.oninput = () => (excerpts[index].text = textarea.value);

    const thumbs = document.createElement("div");
    thumbs.className = "excerpt-thumbs";

    item.images.forEach((image, imageIndex) => {
      const wrap = document.createElement("div");
      wrap.className = "thumb";

      const img = document.createElement("img");
      if (image.blob) {
        img.src = URL.createObjectURL(image.blob);
      } else if (image.assetId) {
        getAsset(image.assetId).then((asset) => {
          if (asset && asset.blob) img.src = URL.createObjectURL(asset.blob);
        });
      }

      const del = document.createElement("button");
      del.className = "thumb-del";
      del.innerText = "×";
      del.onclick = () => removeExcerptImage(index, imageIndex);

      wrap.appendChild(img);
      wrap.appendChild(del);
      thumbs.appendChild(wrap);
    });

    const tools = document.createElement("div");
    tools.className = "excerpt-tools";
    tools.innerHTML = `
      <button class="mini-btn" data-act="img">添加图片</button>
      <button class="mini-btn danger" data-act="del">删除这条</button>
    `;
    tools.querySelector('[data-act="img"]').onclick = () => pickExcerptImages(index);
    tools.querySelector('[data-act="del"]').onclick = () => removeExcerpt(index);

    box.appendChild(textarea);
    box.appendChild(thumbs);
    box.appendChild(tools);
    list.appendChild(box);
  });
}

/* ===============================
   载入已有书籍（编辑模式）
================================ */
async function loadExisting(id) {
  const book = getBookById(id);
  if (!book) {
    alert("找不到这本书");
    location.href = "index.html";
    return;
  }

  setValue("f-title", book.title);
  setValue("f-author", book.author);
  setValue("f-url", book.url);
  setValue("f-words", book.words);
  setValue("f-publisher", book.publisher);
  setValue("f-description", book.description);
  setValue("f-review", book.review);
  setValue("f-start", book.startDate);
  setValue("f-end", book.endDate);

  if (book.source) {
    addOption("source", book.source);
    renderOptionSelects();
    setValue("f-source", book.source);
  }
  if (book.category) {
    addOption("category", book.category);
    renderOptionSelects();
    setValue("f-category", book.category);
  }

  selectedTags = (book.tags || []).slice();
  selectedTags.forEach((tag) => addOption("tags", tag));
  renderTagPicker();

  rating = book.rating || 0;
  paintHearts();

  attachments = (book.attachments || []).map((a) => Object.assign({}, a));
  renderAttachments();

  excerpts = (book.excerpts || []).map((e) => ({
    id: e.id,
    text: e.text || "",
    images: (e.images || []).map((img) => Object.assign({}, img)),
  }));
  renderExcerpts();

  setStatus(book.status || "在读");

  if (book.cover === "custom") {
    coverKept = true;
    try {
      const blob = await getCover(book.id);
      if (blob) showCoverPreview(URL.createObjectURL(blob));
    } catch (e) {
      console.warn(e);
    }
  } else if (book.cover && book.cover !== "assets/default-cover.jpg") {
    showCoverPreview(book.cover);
  }
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

/* ===============================
   保存
================================ */
async function submitBook() {
  const title = getValue("f-title");
  if (!title) {
    alert("书名要填一下");
    document.getElementById("f-title").focus();
    return;
  }

  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.innerText = "保存中…";

  try {
    const existing = editingId ? getBookById(editingId) : null;
    const id = existing ? existing.id : Date.now();

    // 1. 附件：新文件写入 IndexedDB
    const savedAttachments = [];
    for (const item of attachments) {
      if (item.kind === "link") {
        savedAttachments.push({ kind: "link", name: item.name, url: item.url });
        continue;
      }
      if (item.assetId) {
        savedAttachments.push({
          kind: "file", name: item.name, ext: item.ext, size: item.size,
          mime: item.mime, assetId: item.assetId,
        });
        continue;
      }
      const assetId = await saveAsset({
        id: newAssetId(), bookId: id, kind: "attachment",
        name: item.name, mime: item.mime, size: item.size, blob: item.blob,
      });
      savedAttachments.push({
        kind: "file", name: item.name, ext: item.ext, size: item.size,
        mime: item.mime, assetId: assetId,
      });
    }

    // 2. 书摘图片
    const savedExcerpts = [];
    for (const item of excerpts) {
      const images = [];
      for (const image of item.images) {
        if (image.assetId) {
          images.push({ name: image.name, assetId: image.assetId });
          continue;
        }
        const assetId = await saveAsset({
          id: newAssetId(), bookId: id, kind: "excerpt",
          name: image.name, mime: image.mime, size: image.blob ? image.blob.size : 0, blob: image.blob,
        });
        images.push({ name: image.name, assetId: assetId });
      }
      savedExcerpts.push({ id: item.id, text: item.text, images: images });
    }

    // 3. 封面
    let coverValue = existing ? existing.cover : "assets/default-cover.jpg";
    if (coverBlob) {
      await saveCover(id, coverBlob);
      coverValue = "custom";
    } else if (!coverKept && existing && existing.cover === "custom") {
      await deleteCover(id);
      coverValue = "assets/default-cover.jpg";
    }

    // 4. 组装书籍
    const status = currentStatus;
    const book = Object.assign({}, existing || {}, {
      id: id,
      title: title,
      author: getValue("f-author") || "未知作者",
      url: getValue("f-url"),
      words: getValue("f-words"),
      publisher: getValue("f-publisher"),
      source: getValue("f-source"),
      category: getValue("f-category"),
      tags: selectedTags.slice(),
      description: getValue("f-description"),
      cover: coverValue,
      attachments: savedAttachments,
      status: status,
      startDate: status === "弃读" ? "" : getValue("f-start"),
      endDate: status === "已读" ? getValue("f-end") : "",
      rating: status === "已读" ? rating : 0,
      review: status === "已读" || status === "弃读" ? getValue("f-review") : "",
      excerpts: status === "已读" ? savedExcerpts : (existing ? existing.excerpts || [] : []),
    });

    if (!existing) {
      book.progress = 0;
      book.readSeconds = 0;
      book.readTime = 0;
      book.readCount = 0;
      book.sessions = [];
      book.notes = [];
      book.createTime = new Date().toLocaleString();
      await addBook(book, null);
    } else {
      updateBook(book);
    }

    location.href = "book-detail.html?id=" + encodeURIComponent(id);
  } catch (err) {
    console.error(err);
    alert("保存失败：" + err.message);
    saveBtn.disabled = false;
    saveBtn.innerText = editingId ? "保存修改" : "保存到书架";
  }
}

/* ===============================
   工具
================================ */
function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

window.goBack = goBack;
window.pickCover = pickCover;
window.recropCover = recropCover;
window.clearCover = clearCover;
window.createOption = createOption;
window.pickMetaFile = pickMetaFile;
window.importFromUrl = importFromUrl;
window.importFromHtml = importFromHtml;
window.toggleHtmlPaste = toggleHtmlPaste;
window.pickAttachments = pickAttachments;
window.addLinkAttachment = addLinkAttachment;
window.addExcerpt = addExcerpt;
window.clearRating = clearRating;
window.submitBook = submitBook;
window.escapeHtml = escapeHtml;
