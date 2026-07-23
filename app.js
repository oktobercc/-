// JSONBin 配置
const API_KEY = '$2a$10$1jLLuxJHp1ItkhyjiSobF.OXWtupctQqBui80XdP.f.DfkuQ7uQzu';
const BIN_ID = '6a625757f5f4af5e29b792c9';

let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let currentIndex = -1;
let startTime = null;
let rendition;
let isSyncing = false;

/* ========== 云端同步 ========== */
async function saveToCloud() {
  if (isSyncing) return;
  isSyncing = true;
  
  try {
    // 只同步书籍元数据，不同步文件数据
    const booksForSync = books.map(book => {
      const bookCopy = JSON.parse(JSON.stringify(book));
      
      // 如果 epub 是 base64 数据，替换为索引
      if (bookCopy.epub && bookCopy.epub.startsWith('data:')) {
        bookCopy.epub = '';
      }
      
      // 附件中移除数据，只保留引用
      if (bookCopy.附件) {
        bookCopy.附件 = bookCopy.附件.map(att => {
          if (att.data) {
            return {
              ...att,
              data: undefined
            };
          }
          return att;
        });
      }
      
      return bookCopy;
    });
    
    const payload = { books: booksForSync };
    
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': API_KEY
      },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log("✅ 已同步到云端");
    } else {
      const errorData = await response.json();
      console.warn("⚠️ 云端同步失败，状态码:", response.status, errorData);
    }
  } catch (e) {
    console.warn("⚠️ 云端同步失败", e);
  } finally {
    isSyncing = false;
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
      if (data.record && data.record.books && Array.isArray(data.record.books)) {
        books = data.record.books;
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
  // 保存到 localStorage（只存元数据，文件在 IndexedDB）
  const booksForStorage = books.map(book => {
    const bookCopy = JSON.parse(JSON.stringify(book));
    
    // 如果 epub 是 base64 数据，清除（应该已经迁移到 IndexedDB）
    if (bookCopy.epub && bookCopy.epub.startsWith('data:')) {
      bookCopy.epub = '';
    }
    
    // 附件中移除 data
    if (bookCopy.附件) {
      bookCopy.附件 = bookCopy.附件.map(att => {
        if (att.data) {
          return {
            ...att,
            data: undefined
          };
        }
        return att;
      });
    }
    
    return bookCopy;
  });
  
  localStorage.setItem("books", JSON.stringify(booksForStorage));
  
  // 延迟同步到云端
  clearTimeout(window._saveTimeout);
  window._saveTimeout = setTimeout(() => {
    saveToCloud();
  }, 500);
}

/* ========== 视图切换（更新标题） ========== */
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view).classList.add('active');
  
  // 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const navMap = {
    'gallery': 0,
    'dashboard': 1,
    'calendar': 2
  };
  const navItems = document.querySelectorAll('.nav-item');
  if (navMap[view] !== undefined) {
    navItems[navMap[view]].classList.add('active');
  }
  
  // 更新标题
  const titles = {
    'gallery': '📚 书墙',
    'dashboard': '📊 仪表盘',
    'calendar': '📅 日历'
  };
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) {
    titleEl.textContent = titles[view] || '📚 书墙';
  }
}

/* ========== 主题切换 ========== */
function toggleTheme() {
  document.body.classList.toggle('dark');
  // 更新主题按钮图标
  const themeBtn = document.querySelector('.nav-footer .nav-item .nav-icon');
  if (themeBtn) {
    themeBtn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
  }
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
    附件: [],
    epub: ""
  };
  
  books.push(newBook);
  save();
  render();
  
  const index = books.length - 1;
  openDetail(index);
}

/* ========== 渲染卡片 ========== */
function render() {
  const grid = document.getElementById("booksGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!books || books.length === 0) {
    grid.innerHTML = '<p style="color:#999;text-align:center;grid-column:1/-1;padding:60px 0;font-size:16px;">📚 还没有书籍，点击右上角"＋ 添加"开始吧</p>';
    return;
  }

  books.forEach((b, i) => {
    const div = document.createElement("div");
    div.className = "book-card";

    const coverImg = b.封面 || 'https://via.placeholder.com/300x450?text=No+Cover';
    
    // 状态标签
    let statusClass = 'status-unread';
    let statusText = '未读';
    if (b.阅读状态 === '在读') { statusClass = 'status-reading'; statusText = '在读'; }
    else if (b.阅读状态 === '已读') { statusClass = 'status-read'; statusText = '已读'; }
    else if (b.阅读状态 === '弃读') { statusClass = 'status-abandoned'; statusText = '弃读'; }
    
    div.innerHTML = `
      <img class="book-cover" src="${coverImg}" alt="${b.书名 || '未命名'}">
      <div class="book-info">
        <div class="book-title">${b.书名 || '未命名'}</div>
        <div class="book-author">${b.作者 || '未知作者'}</div>
        <span class="book-status ${statusClass}">${statusText}</span>
      </div>
    `;

    div.onclick = () => openDetail(i);
    grid.appendChild(div);
  });
}

/* ========== 文件处理工具函数 ========== */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/* ========== 打开详情 ========== */
function openDetail(index) {
  if (index < 0 || index >= books.length) {
    console.error('索引超出范围');
    return;
  }
  
  currentIndex = index;
  currentBook = books[index];
  
  const d = document.getElementById("drawer");
  const c = document.getElementById("drawerContent");

  const statusOptions = ['未读', '在读', '已读', '弃读'];
  const statusSelect = statusOptions.map(s => 
    `<option value="${s}" ${currentBook.阅读状态 === s ? 'selected' : ''}>${s}</option>`
  ).join('');

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
    <input value="${currentBook.标签 ? currentBook.标签.join(',') : ''}" 
      oninput="updateTags(this.value)" placeholder="例如：科幻, 文学, 推理" />

    <label>📖 简介</label>
    <textarea oninput="updateField('简介',this.value)">${currentBook.简介 || ''}</textarea>

    <label>✍️ 书评</label>
    <textarea oninput="updateField('书评',this.value)">${currentBook.书评 || ''}</textarea>

    <label>📝 书摘</label>
    <textarea oninput="updateField('书摘',this.value)">${currentBook.书摘 || ''}</textarea>

    <hr>

    <!-- 统一的附件上传区域 -->
    <label>📎 附件（支持 EPUB、TXT、PDF、MOBI、AZW3 等）</label>
    <div class="file-upload-area" id="attachmentArea">
      <div class="upload-options">
        <input type="file" multiple accept=".epub,.txt,.azw3,.pdf,.mobi,.doc,.docx,.jpg,.png,.mp3,.mp4" 
               onchange="uploadAttachments(event)" style="flex:1;">
        <input type="text" id="attachmentLinkInput" placeholder="或输入文件链接" style="flex:2;">
        <button onclick="addAttachmentLink()">添加链接</button>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#999;">
        💡 提示：上传的文件将存储在 IndexedDB 中，链接文件只保存地址
      </div>
      <div id="attachmentList">
        ${attachmentsHtml}
      </div>
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
    const isStored = file.type === 'file' && file.fileId;
    const icon = isLink ? '🔗' : '📄';
    const name = isLink ? file.name : file.fileName;
    const size = isLink ? '' : formatFileSize(file.size);
    const ext = isLink ? '' : getFileExtension(name);
    
    // 判断是否为 EPUB 文件（用于阅读按钮）
    const isEpub = ext === 'epub' || (file.fileName && getFileExtension(file.fileName) === 'epub');
    const epubBadge = isEpub ? `<span class="file-type-badge" style="background:#e67e22;">EPUB</span>` : '';
    const storedBadge = isStored ? `<span class="file-type-badge" style="background:#27ae60;">已存储</span>` : '';
    
    return `
      <div class="file-item">
        <div class="file-info">
          <span>${icon}</span>
          <span class="file-name" title="${name}">${name}</span>
          ${ext ? `<span class="file-type-badge">${ext.toUpperCase()}</span>` : ''}
          ${epubBadge}
          ${storedBadge}
          ${size ? `<span class="file-size">${size}</span>` : ''}
        </div>
        <div style="display:flex;gap:4px;">
          ${isEpub && isStored ? `<button class="read-file-btn" onclick="readAttachment(${idx})" title="阅读此文件">📖</button>` : ''}
          <button class="remove-file" onclick="removeAttachment(${idx})" title="删除">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ========== 上传附件（统一处理所有文件） ========== */
async function uploadAttachments(event) {
  const files = event.target.files;
  if (!files || files.length === 0 || !currentBook) return;
  
  if (!currentBook.附件) currentBook.附件 = [];
  
  // 显示上传进度
  const progressDiv = document.createElement('div');
  progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:20px;border-radius:10px;z-index:9999;text-align:center;min-width:200px;';
  progressDiv.innerHTML = `<div>⏳ 正在上传 0/${files.length}</div><div style="font-size:12px;margin-top:8px;color:#aaa;">请稍候...</div>`;
  document.body.appendChild(progressDiv);
  
  let completed = 0;
  let hasError = false;
  
  for (const file of files) {
    try {
      // 检查文件大小
      if (file.size > 100 * 1024 * 1024) {
        alert(`文件 ${file.name} 超过100MB，请使用链接方式`);
        continue;
      }
      
      progressDiv.innerHTML = `<div>⏳ 正在上传 ${completed + 1}/${files.length}</div><div style="font-size:13px;margin-top:8px;">${file.name}</div><div style="font-size:12px;margin-top:4px;color:#aaa;">${formatFileSize(file.size)}</div>`;
      
      const arrayBuffer = await readFileAsArrayBuffer(file);
      
      // 保存到 IndexedDB
      const fileId = await saveFileToIndexedDB(
        currentBook.id,
        'attachment',
        file.name,
        arrayBuffer,
        { size: file.size, type: file.type }
      );
      
      currentBook.附件.push({
        type: 'file',
        fileName: file.name,
        size: file.size,
        fileId: fileId,
        uploadDate: new Date().toISOString()
      });
      
      completed++;
    } catch (e) {
      console.error('保存附件失败:', e);
      alert(`保存附件 ${file.name} 失败: ${e.message}`);
      hasError = true;
    }
  }
  
  // 移除进度提示
  document.body.removeChild(progressDiv);
  
  if (completed > 0) {
    save();
    if (currentIndex >= 0) openDetail(currentIndex);
    alert(`✅ 成功上传 ${completed}/${files.length} 个文件${hasError ? ' (部分失败)' : ''}`);
  }
  
  event.target.value = '';
}

/* ========== 添加附件链接 ========== */
function addAttachmentLink() {
  const input = document.getElementById('attachmentLinkInput');
  if (!input) return;
  
  const url = input.value.trim();
  if (!url) {
    alert('请输入链接地址');
    return;
  }
  
  if (!currentBook.附件) currentBook.附件 = [];
  
  const fileName = url.split('/').pop() || '链接文件';
  
  currentBook.附件.push({
    type: 'link',
    name: fileName,
    url: url,
    uploadDate: new Date().toISOString()
  });
  
  save();
  if (currentIndex >= 0) openDetail(currentIndex);
  input.value = '';
}

/* ========== 移除附件 ========== */
async function removeAttachment(index) {
  if (!currentBook.附件) return;
  
  const file = currentBook.附件[index];
  
  // 如果是存储的文件，从 IndexedDB 删除
  if (file.type === 'file' && file.fileId) {
    try {
      await deleteFileFromIndexedDB(file.fileId);
      console.log('✅ 已从 IndexedDB 删除附件');
    } catch (e) {
      console.warn('删除 IndexedDB 附件失败:', e);
    }
  }
  
  currentBook.附件.splice(index, 1);
  save();
  if (currentIndex >= 0) openDetail(currentIndex);
}

/* ========== 从附件阅读 EPUB ========== */
async function readAttachment(index) {
  if (!currentBook.附件 || index >= currentBook.附件.length) return;
  
  const file = currentBook.附件[index];
  if (file.type !== 'file' || !file.fileId) {
    alert('该附件不是已存储的文件');
    return;
  }
  
  // 检查是否为 EPUB
  const ext = getFileExtension(file.fileName);
  if (ext !== 'epub') {
    alert('只支持 EPUB 格式');
    return;
  }
  
  try {
    const fileData = await getFileFromIndexedDB(file.fileId);
    if (fileData && fileData.data) {
      // 创建 Blob URL
      const blob = new Blob([fileData.data], { type: 'application/epub+zip' });
      const epubSource = URL.createObjectURL(blob);
      
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
        alert("无法加载epub文件，请检查文件是否有效。");
        console.error(e);
      }
    } else {
      alert('找不到 EPUB 文件数据');
    }
  } catch (e) {
    console.error('读取 EPUB 文件失败:', e);
    alert('读取 EPUB 文件失败: ' + e.message);
  }
}

/* ========== 阅读器（修改：优先从附件查找 EPUB） ========== */
async function openReader() {
  if (!currentBook) return;

  // 首先尝试从附件中查找 EPUB 文件
  let epubFile = null;
  let epubIndex = -1;
  
  if (currentBook.附件) {
    for (let i = 0; i < currentBook.附件.length; i++) {
      const att = currentBook.附件[i];
      if (att.type === 'file' && att.fileName && getFileExtension(att.fileName) === 'epub') {
        epubFile = att;
        epubIndex = i;
        break;
      }
    }
  }
  
  let epubSource = null;
  
  // 如果找到 EPUB 附件，使用它
  if (epubFile && epubFile.fileId) {
    try {
      const fileData = await getFileFromIndexedDB(epubFile.fileId);
      if (fileData && fileData.data) {
        const blob = new Blob([fileData.data], { type: 'application/epub+zip' });
        epubSource = URL.createObjectURL(blob);
        console.log('✅ 从附件加载 EPUB');
      }
    } catch (e) {
      console.error('加载 EPUB 附件失败:', e);
    }
  }
  
  // 如果没有附件 EPUB，检查 epub 字段
  if (!epubSource && currentBook.epub) {
    if (currentBook.epub.startsWith('indexeddb://')) {
      const fileId = currentBook.epub.replace('indexeddb://', '');
      try {
        const fileData = await getFileFromIndexedDB(fileId);
        if (fileData && fileData.data) {
          const blob = new Blob([fileData.data], { type: 'application/epub+zip' });
          epubSource = URL.createObjectURL(blob);
          console.log('✅ 从 IndexedDB 加载 EPUB');
        }
      } catch (e) {
        console.error('加载 EPUB 失败:', e);
      }
    } else if (currentBook.epub.startsWith('http')) {
      epubSource = currentBook.epub;
      console.log('✅ 从链接加载 EPUB');
    }
  }
  
  // 如果还是没有 EPUB，让用户选择
  if (!epubSource) {
    const choice = confirm('没有找到 EPUB 文件，是否要上传？\n点击"确定"上传文件，点击"取消"输入链接');
    if (choice) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const arrayBuffer = await readFileAsArrayBuffer(file);
          const fileId = await saveFileToIndexedDB(
            currentBook.id,
            'attachment',
            file.name,
            arrayBuffer,
            { size: file.size, type: file.type }
          );
          
          if (!currentBook.附件) currentBook.附件 = [];
          currentBook.附件.push({
            type: 'file',
            fileName: file.name,
            size: file.size,
            fileId: fileId,
            uploadDate: new Date().toISOString()
          });
          save();
          openReader();
        } catch (err) {
          alert('读取EPUB文件失败');
        }
      };
      input.click();
      return;
    } else {
      const url = prompt("请输入epub文件链接：");
      if (!url) return;
      currentBook.epub = url;
      epubSource = url;
      save();
    }
  }

  if (!epubSource) return;
  
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
async function deleteBook() {
  if (!currentBook || !confirm(`确定要删除《${currentBook.书名}》吗？`)) return;

  // 清理 IndexedDB 中的文件
  try {
    await clearFilesForBook(currentBook.id);
    console.log('✅ 已清理 IndexedDB 文件');
  } catch (e) {
    console.warn('清理 IndexedDB 文件失败:', e);
  }

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

/* ========== 搜索 ========== */
function searchBooks() {
  const q = document.getElementById("search").value.toLowerCase();
  document.querySelectorAll(".book-card").forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? "" : "none";
  });
}

/* ========== 显示存储信息 ========== */
async function showStorageInfo() {
  try {
    const info = await getStorageInfo();
    // 计算总附件数
    let totalAttachments = 0;
    books.forEach(book => {
      if (book.附件) {
        totalAttachments += book.附件.length;
      }
    });
    
    const message = `
📊 IndexedDB 存储信息
━━━━━━━━━━━━━━━━━━━
📁 文件数量: ${info.count}
💾 总大小: ${info.totalSizeFormatted}
━━━━━━━━━━━━━━━━━━━
📚 书籍数量: ${books.length}
📎 附件总数: ${totalAttachments}
💾 localStorage: ${formatFileSize(new Blob([JSON.stringify(books)]).size)}
    `;
    alert(message);
  } catch (e) {
    console.error('获取存储信息失败:', e);
    alert('获取存储信息失败');
  }
}

/* ========== 初始化 ========== */
async function init() {
  // 初始化 IndexedDB
  try {
    await openDB();
    console.log('✅ IndexedDB 初始化完成');
  } catch (e) {
    console.warn('IndexedDB 初始化失败:', e);
  }
  
  const loaded = await loadFromCloud();
  if (!loaded) {
    books = JSON.parse(localStorage.getItem("books") || "[]");
    render();
  }
  
  // 默认激活书墙
  switchView('gallery');
}

// 启动应用
init();
