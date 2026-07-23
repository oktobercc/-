// ===== app.js =====
// 完整应用逻辑，无演示数据

// 常量
const API_KEY = '$2a$10$1jLLuxJHp1ItkhyjiSobF.OXWtupctQqBui80XdP.f.DfkuQ7uQzu';
const BIN_ID = '6a625757f5f4af5e29b792c9';

// 状态
let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let currentIndex = -1;
let startTime = null;
let rendition = null;
let isSyncing = false;

// ========== DOM 引用 ==========
const $ = id => document.getElementById(id);
const booksGrid = $('booksGrid');
const drawer = $('drawer');
const drawerContent = $('drawerContent');
const reader = $('reader');
const viewer = $('viewer');
const searchInput = $('search');
const viewTitle = $('viewTitle');

// ========== 导航切换 ==========
function switchView(viewName) {
  // 隐藏所有视图
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  // 显示目标视图
  const targetView = document.getElementById(viewName);
  if (targetView) targetView.classList.add('active');
  
  // 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.view === viewName) {
      item.classList.add('active');
    }
  });
  
  // 更新标题
  const titles = {
    'gallery': '书架',
    'dashboard': '仪表盘',
    'calendar': '日历'
  };
  if (viewTitle) viewTitle.textContent = titles[viewName] || '书架';
}

// ========== 主题切换 ==========
function toggleTheme() {
  document.body.classList.toggle('dark');
  const themeIcon = document.querySelector('#themeToggle .nav-icon');
  if (themeIcon) {
    themeIcon.textContent = document.body.classList.contains('dark') ? '☀️' : '☪';
  }
}

// ========== 云端同步 ==========
async function saveToCloud() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const booksForSync = books.map(book => {
      const copy = JSON.parse(JSON.stringify(book));
      if (copy.epub && copy.epub.startsWith('data:')) copy.epub = '';
      if (copy.附件) {
        copy.附件 = copy.附件.map(att => {
          if (att.data) { return { ...att, data: undefined }; }
          return att;
        });
      }
      return copy;
    });
    const resp = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY },
      body: JSON.stringify({ books: booksForSync })
    });
    if (resp.ok) console.log('✅ 已同步到云端');
  } catch (e) { console.warn('⚠️ 云端同步失败', e); }
  finally { isSyncing = false; }
}

async function loadFromCloud() {
  try {
    const resp = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      headers: { 'X-Master-Key': API_KEY }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.record?.books) {
        books = data.record.books;
        localStorage.setItem("books", JSON.stringify(books));
        render();
        return true;
      }
    }
  } catch (e) { console.warn('⚠️ 从云端加载失败', e); }
  return false;
}

// ========== 保存 ==========
function save() {
  const booksForStorage = books.map(book => {
    const copy = JSON.parse(JSON.stringify(book));
    if (copy.epub && copy.epub.startsWith('data:')) copy.epub = '';
    if (copy.附件) {
      copy.附件 = copy.附件.map(att => {
        if (att.data) { return { ...att, data: undefined }; }
        return att;
      });
    }
    return copy;
  });
  localStorage.setItem("books", JSON.stringify(booksForStorage));
  clearTimeout(window._saveTimeout);
  window._saveTimeout = setTimeout(saveToCloud, 500);
}

// ========== 渲染 ==========
function render() {
  if (!booksGrid) return;
  booksGrid.innerHTML = '';
  if (!books.length) {
    booksGrid.innerHTML = '<p style="color:#999;text-align:center;grid-column:1/-1;padding:60px 0;font-size:16px;">📚 还没有书籍，点击右上角"＋ 添加"开始吧</p>';
    return;
  }
  books.forEach((b, i) => {
    const div = document.createElement('div');
    div.className = 'book-card';
    const cover = b.封面 || 'https://via.placeholder.com/300x450?text=No+Cover';
    let statusClass = 'status-unread', statusText = '未读';
    if (b.阅读状态 === '在读') { statusClass = 'status-reading'; statusText = '在读'; }
    else if (b.阅读状态 === '已读') { statusClass = 'status-read'; statusText = '已读'; }
    else if (b.阅读状态 === '弃读') { statusClass = 'status-abandoned'; statusText = '弃读'; }
    div.innerHTML = `
      <img class="book-cover" src="${cover}" alt="${b.书名 || '未命名'}">
      <div class="book-info">
        <div class="book-title">${b.书名 || '未命名'}</div>
        <div class="book-author">${b.作者 || '未知作者'}</div>
        <span class="book-status ${statusClass}">${statusText}</span>
      </div>
    `;
    div.onclick = () => openDetail(i);
    booksGrid.appendChild(div);
  });
}

// ========== 工具函数 ==========
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}
function getFileExtension(filename) {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ========== 添加书籍 ==========
function addBook() {
  const newBook = {
    id: Date.now(),
    书名: '新书',
    网址: '',
    封面: '',
    作者: '',
    字数: '',
    来源: '',
    作品类型: '',
    标签: [],
    简介: '',
    开始日期: '',
    结束日期: '',
    评分: 0,
    阅读时长: 0,
    阅读进度: 0,
    阅读状态: '未读',
    书评: '',
    书摘: '',
    附件: [],
    epub: ''
  };
  books.push(newBook);
  save();
  render();
  openDetail(books.length - 1);
}

// ========== 打开详情 ==========
function openDetail(index) {
  if (index < 0 || index >= books.length) return;
  currentIndex = index;
  currentBook = books[index];
  drawerContent.innerHTML = buildDetailHTML(currentBook);
  drawer.classList.remove('hidden');
}

function buildDetailHTML(book) {
  const statusOptions = ['未读', '在读', '已读', '弃读'];
  const statusSelect = statusOptions.map(s =>
    `<option value="${s}" ${book.阅读状态 === s ? 'selected' : ''}>${s}</option>`
  ).join('');
  const attHtml = generateAttachmentsHtml(book.附件 || []);
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2 contenteditable="true" oninput="updateField('书名',this.innerText)">${book.书名 || '新书'}</h2>
      <button onclick="closeDrawer()" style="background:none;border:none;font-size:24px;cursor:pointer;">✕</button>
    </div>
    <label>📷 封面</label>
    <div style="display:flex;gap:10px;align-items:center;">
      <input type="file" accept="image/*" onchange="uploadCover(event)" style="flex:1;">
      ${book.封面 ? `<img src="${book.封面}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;">` : ''}
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
    <select onchange="updateField('阅读状态',this.value)">${statusSelect}</select>
    <label>🏷️ 标签（逗号分隔）</label>
    <input value="${book.标签 ? book.标签.join(',') : ''}" oninput="updateTags(this.value)" placeholder="科幻, 文学" />
    <label>📖 简介</label>
    <textarea oninput="updateField('简介',this.value)">${book.简介 || ''}</textarea>
    <label>✍️ 书评</label>
    <textarea oninput="updateField('书评',this.value)">${book.书评 || ''}</textarea>
    <label>📝 书摘</label>
    <textarea oninput="updateField('书摘',this.value)">${book.书摘 || ''}</textarea>
    <hr>
    <label>📎 附件</label>
    <div class="file-upload-area">
      <div class="upload-options">
        <input type="file" multiple accept=".epub,.txt,.azw3,.pdf,.mobi,.doc,.docx,.jpg,.png,.mp3,.mp4" onchange="uploadAttachments(event)">
        <input type="text" id="attachmentLinkInput" placeholder="或输入链接" style="flex:2;">
        <button onclick="addAttachmentLink()">添加链接</button>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#999;">💡 文件存储在 IndexedDB</div>
      <div id="attachmentList">${attHtml}</div>
    </div>
    <hr>
    <div class="info-row"><span>📊 阅读进度</span><span>${book.阅读进度 || 0}%</span></div>
    <div class="info-row"><span>⏱️ 阅读时长</span><span>${Math.floor((book.阅读时长 || 0)/60)} 分钟</span></div>
    <div class="btn-group">
      <button class="btn-primary" onclick="openReader()">📖 阅读</button>
      <button class="btn-danger" onclick="deleteBook()">🗑 删除</button>
    </div>
  `;
}

function createInput(field, type = 'text', min = null, max = null) {
  const val = currentBook[field] || '';
  const minAttr = min !== null ? ` min="${min}"` : '';
  const maxAttr = max !== null ? ` max="${max}"` : '';
  return `<label>${field}</label><input type="${type}" value="${val}" oninput="updateField('${field}',this.value)"${minAttr}${maxAttr} />`;
}

function generateAttachmentsHtml(attachments) {
  if (!attachments || !attachments.length) return '<div style="color:#999;font-size:13px;padding:8px 0;">暂无附件</div>';
  return attachments.map((file, idx) => {
    const isLink = file.type === 'link';
    const isStored = file.type === 'file' && file.fileId;
    const icon = isLink ? '🔗' : '📄';
    const name = isLink ? file.name : file.fileName;
    const size = isLink ? '' : formatFileSize(file.size);
    const ext = isLink ? '' : getFileExtension(name);
    const isEpub = ext === 'epub' || (file.fileName && getFileExtension(file.fileName) === 'epub');
    const epubBadge = isEpub ? `<span class="file-type-badge" style="background:#e67e22;">EPUB</span>` : '';
    const storedBadge = isStored ? `<span class="file-type-badge" style="background:#27ae60;">已存储</span>` : '';
    return `
      <div class="file-item">
        <div class="file-info">
          <span>${icon}</span>
          <span class="file-name" title="${name}">${name}</span>
          ${ext ? `<span class="file-type-badge
