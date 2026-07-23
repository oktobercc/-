// JSONBin 配置
const API_KEY = '$2a$10$1jLLuxJHp1ItkhyjiSobF.OXWtupctQqBui80XdP.f.DfkuQ7uQzu';
const BIN_ID = '6a625757f5f4af5e29b792c9';

let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let currentIndex = -1;
let startTime = null;
let rendition;

/* ========== 云端同步 ========== */
async function saveToCloud() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': API_KEY
      },
      body: JSON.stringify(books)
    });
    
    if (response.ok) {
      console.log("✅ 已同步到云端");
    } else {
      console.warn("⚠️ 云端同步失败，状态码:", response.status);
    }
  } catch (e) {
    console.warn("⚠️ 云端同步失败", e);
  }
}

async function loadFromCloud() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      headers: {
        'X-Master-Key': API_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.record && Array.isArray(data.record)) {
        books = data.record;
        localStorage.setItem("books", JSON.stringify(books));
        render();
        return true;
      }
    }
  } catch (e) {
    console.warn("⚠️ 从云端加载失败", e);
  }
  return false;
}

/* ========== 保存 ========== */
function save() {
  localStorage.setItem("books", JSON.stringify(books));
  saveToCloud(); // 异步同步到云端
}

/* ========== 视图切换 ========== */
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view).classList.add('active');
}

/* ========== 主题切换 ========== */
function toggleTheme() {
  document.body.classList.toggle('dark');
}

/* ========== 添加书 ========== */
function addBook() {
  const newBook = {
    id: Date.now(),
    书名: "新书",
    网址: "",
    封面: "",
    作者: "",
    字数: "",
    来源: "",
    作品类型: "",
    标签: [],
    简介: "",
    开始日期: "",
    结束日期: "",
    评分: 0,
    阅读时长: 0,
    阅读进度: 0,
    阅读状态: "未读",
    书评: "",
    书摘: "",
    附件: [], // 改为数组，存储多个文件
    epub: "" // 保留单个EPUB链接，但增加文件上传支持
  };
  
  books.push(newBook);
  save();
  render();
  
  const index = books.length - 1;
  openDetail(index);
}

/* ========== 渲染卡片 ========== */
function render() {
  const gallery = document.getElementById("gallery");
  gallery.innerHTML = "";

  books.forEach((b, i) => {
    const div = document.createElement("div");
    div.className = "card";

    const coverImg = b.封面 || 'https://via.placeholder.com/150x200?text=No+Cover';
    
    div.innerHTML = `
      <img src="${coverImg}" alt="${b.书名}">
      <p>${b.书名 || '未命名'}</p>
    `;

    div.onclick = () => openDetail(i);
    gallery.appendChild(div);
  });
}

/* ========== 文件处理工具函数 ========== */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function isSupportedFileType(ext) {
  const supported = ['epub', 'txt', 'azw3', 'pdf', 'mobi', 'doc', 'docx'];
  return supported.includes(ext);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ========== 打开详情 ========== */
function openDetail(index) {
  currentIndex = index;
  currentBook = books[index];
  
  const d = document.getElementById("drawer");
  const c = document.getElementById("drawerContent");

  const statusOptions = ['未读', '在读', '已读', '弃读'];
  const statusSelect = statusOptions.map(s => 
    `<option value="${s}" ${currentBook.阅读状态 === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  // 生成附件列表HTML
  const attachmentsHtml = generateAttachmentsHtml(currentBook.附件 || []);

  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2 contenteditable="true" oninput="updateField('书名',this.innerText)">${currentBook.书名 || '新书'}</h2>
      <button onclick="closeDrawer()" style="background:none;border:none;font-size:24px;cursor:pointer;">✕</button>
    </div>

    <!-- 封面上传 -->
    <label>📷 封面</label>
    <div style="display:flex;gap:10px;align-items:center;">
      <input type="file" accept="image/*" onchange="uploadCover(event)" style="flex:1;">
      ${currentBook.封面 ? `<img src="${currentBook.封面}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;">` : ''}
    </div>

    ${createInput('作者', 'text')}
    ${createInput('网址', 'text')}
    ${createInput('来源', 'text')}
    ${createInput('作品类型', 'text')}
    ${createInput('字数', 'text')}
    ${createInput('开始日期', 'date')}
    ${createInput('结束日期', 'date')}
    ${createInput('评分', 'number', 0, 10)}

    <label>📌 阅读状态</label>
    <select onchange="updateField('阅读状态',this.value)">
      ${statusSelect}
    </select>

    <label>🏷️ 标签（用逗号分隔）</label>
    <input value="${currentBook.标签.join(',')}" 
      oninput="updateTags(this.value)" placeholder="例如：科幻, 文学, 推理" />

    <label>📖 简介</label>
    <textarea oninput="updateField('简介',this.value)">${currentBook.简介 || ''}</textarea>

    <label>✍️ 书评</label>
    <textarea oninput="updateField('书评',this.value)">${currentBook.书评 || ''}</textarea>

    <label>📝 书摘</label>
    <textarea oninput="updateField('书摘',this.value)">${currentBook.书摘 || ''}</textarea>

    <hr>

    <!-- 附件上传区域（支持多个文件） -->
    <label>📎 附件</label>
    <div class="file-upload-area" id="attachmentArea">
      <div class="upload-options">
        <input type="file" multiple accept=".epub,.txt,.azw3,.pdf,.mobi,.doc,.docx" 
               onchange="uploadAttachments(event)" style="flex:1;">
        <input type="text" id="attachmentLinkInput" placeholder="或输入附件链接" style="flex:2;">
        <button onclick="addAttachmentLink()">添加链接</button>
      </div>
      <div id="attachmentList">
        ${attachmentsHtml}
      </div>
    </div>

    <!-- EPUB 文件（支持上传和链接） -->
    <label>📱 EPUB 文件</label>
    <div class="file-upload-area">
      <div class="upload-options">
        <input type="file" accept=".epub" onchange="uploadEpubFile(event)" style="flex:1;">
        <input type="text" id="epubLinkInput" value="${currentBook.epub || ''}" 
               placeholder="或输入EPUB链接" style="flex:2;" 
               oninput="updateField('epub', this.value)">
      </div>
      ${currentBook.epub ? `<div class="file-item"><span class="file-name">📖 ${currentBook.epub}</span></div>` : ''}
    </div>

    <hr>

    <div class="info-row">
      <span>📊 阅读进度</span>
      <span>${currentBook.阅读进度 || 0}%</span>
    </div>
    <div class="info-row">
      <span>⏱️ 阅读时长</span>
      <span>${Math.floor((currentBook.阅读时长 || 0) / 60)} 分钟</span>
    </div>

    <div class="btn-group">
      <button class="btn-primary" onclick="openReader()">📖 阅读</button>
      <button class="btn-danger" onclick="deleteBook()">🗑 删除</button>
    </div>
  `;

  d.classList.remove("hidden");
}

/* ========== 生成附件列表HTML ========== */
function generateAttachmentsHtml(attachments) {
  if (!attachments || attachments.length === 0) return '<div style="color:#999;font-size:13px;padding:8px 0;">暂无附件</div>';
  
  return attachments.map((file, idx) => {
    const isLink = file.type === 'link';
    const icon = isLink ? '🔗' : '📄';
    const name = isLink ? file.name : file.fileName;
    const size = isLink ? '' : formatFileSize(file.size);
    const ext = isLink ? '' : getFileExtension(name);
    
    return `
      <div class="file-item">
        <div class="file-info">
          <span>${icon}</span>
          <span class="file-name" title="${name}">${name}</span>
          ${ext ? `<span class="file-type-badge">${ext.toUpperCase()}</span>` : ''}
          ${size ? `<span class="file-size">${size}</span>` : ''}
        </div>
        <button class="remove-file" onclick="removeAttachment(${idx})">✕</button>
      </div>
    `;
  }).join('');
}

/* ========== 上传附件（多个文件） ========== */
async function uploadAttachments(event) {
  const files = event.target.files;
  if (!files || files.length === 0 || !currentBook) return;
  
  if (!currentBook.附件) currentBook.附件 = [];
  
  for (const file of files) {
    try {
      const base64 = await readFileAsBase64(file);
      currentBook.附件.push({
        type: 'file',
        fileName: file.name,
        size: file.size,
        data: base64,
        uploadDate: new Date().toISOString()
      });
    } catch (e) {
      console.error('读取文件失败:', e);
      alert(`读取文件 ${file.name} 失败: ${e.message}`);
    }
  }
  
  save();
  render();
  if (currentIndex >= 0) openDetail(currentIndex);
  event.target.value = '';
}

/* ========== 添加附件链接 ========== */
function addAttachmentLink() {
  const input = document.getElementById('attachmentLinkInput');
  const url = input.value.trim();
  if (!url) {
    alert('请输入链接地址');
    return;
  }
  
  if (!currentBook.附件) currentBook.附件 = [];
  
  // 从URL中提取文件名
  const fileName = url.split('/').pop() || '链接文件';
  
  currentBook.附件.push({
    type: 'link',
    name: fileName,
    url: url,
    uploadDate: new Date().toISOString()
  });
  
  save();
  render();
  if (currentIndex >= 0) openDetail(currentIndex);
  input.value = '';
}

/* ========== 移除附件 ========== */
function removeAttachment(index) {
  if (!currentBook.附件) return;
  currentBook.附件.splice(index, 1);
  save();
  render();
  if (currentIndex >= 0) openDetail(currentIndex);
}

/* ========== 上传EPUB文件 ========== */
async function uploadEpubFile(event) {
  const file = event.target.files[0];
  if (!file || !currentBook) return;
  
  try {
    const base64 = await readFileAsBase64(file);
    // 保存为数据URL
    currentBook.epub = base64;
    save();
    if (currentIndex >= 0) openDetail(currentIndex);
  } catch (e) {
    console.error('读取EPUB文件失败:', e);
    alert('读取EPUB文件失败: ' + e.message);
  }
  
  event.target.value = '';
}

/* ========== 创建输入字段 ========== */
function createInput(field, type = "text", min = null, max = null) {
  const value = currentBook[field] || '';
  const attrs = `type="${type}" value="${value}" oninput="updateField('${field}',this.value)"`;
  const minMax = min !== null ? ` min="${min}"` : '';
  const maxAttr = max !== null ? ` max="${max}"` : '';
  
  return `
    <label>${field}</label>
    <input ${attrs}${minMax}${maxAttr} />
  `;
}

/* ========== 更新字段 ========== */
function updateField(field, value) {
  if (currentBook) {
    currentBook[field] = value;
    save();
  }
}

/* ========== 更新标签 ========== */
function updateTags(val) {
  if (currentBook) {
    currentBook.标签 = val.split(',').map(t => t.trim()).filter(t => t);
    save();
  }
}

/* ========== 上传封面 ========== */
function uploadCover(e) {
  const file = e.target.files[0];
  if (!file || !currentBook) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    currentBook.封面 = event.target.result;
    save();
    render();
    if (currentIndex >= 0) {
      openDetail(currentIndex);
    }
  };
  reader.readAsDataURL(file);
}

/* ========== 关闭抽屉 ========== */
function closeDrawer() {
  document.getElementById("drawer").classList.add("hidden");
}

/* ========== 删除书籍 ========== */
function deleteBook() {
  if (!currentBook || !confirm(`确定要删除《${currentBook.书名}》吗？`)) return;

  const index = books.findIndex(b => b.id === currentBook.id);
  if (index > -1) {
    books.splice(index, 1);
    save();
    render();
    closeDrawer();
    currentBook = null;
    currentIndex = -1;
  }
}

/* ========== 阅读器 ========== */
function openReader() {
  if (!currentBook) return;

  let epubSource = currentBook.epub;
  
  if (!epubSource) {
    const choice = confirm('没有找到EPUB文件，是否要输入链接？\n点击"确定"输入链接，点击"取消"上传文件');
    if (choice) {
      const url = prompt("请输入epub文件链接：");
      if (!url) return;
      currentBook.epub = url;
      epubSource = url;
    } else {
      // 创建隐藏的文件输入
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const base64 = await readFileAsBase64(file);
          currentBook.epub = base64;
          save();
          openReader(); // 重新打开
        } catch (err) {
          alert('读取EPUB文件失败');
        }
      };
      input.click();
      return;
    }
    save();
  }

  const reader = document.getElementById("reader");
  reader.classList.remove("hidden");

  try {
    const book = ePub(epubSource);
    rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%"
    });
    rendition.display();

    startTime = Date.now();

    rendition.on("relocated", loc => {
      if (currentBook && loc && loc.start) {
        currentBook.阅读进度 = Math.floor(loc.start.percentage * 100);
        save();
      }
    });
  } catch (e) {
    alert("无法加载epub文件，请检查链接是否正确或文件是否有效。");
    console.error(e);
  }
}

/* ========== 关闭阅读器 ========== */
function closeReader() {
  document.getElementById("reader").classList.add("hidden");

  if (startTime && currentBook) {
    const duration = (Date.now() - startTime) / 1000;
    currentBook.阅读时长 = (currentBook.阅读时长 || 0) + duration;
    save();
    startTime = null;
  }
}

/* ========== 搜索 ========== */
function searchBooks() {
  const q = document.getElementById("search").value.toLowerCase();
  document.querySelectorAll(".card").forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? "block" : "none";
  });
}

/* ========== 初始化 ========== */
async function init() {
  const loaded = await loadFromCloud();
  if (!loaded) {
    books = JSON.parse(localStorage.getItem("books") || "[]");
    render();
  }
}

// 启动应用
init();
