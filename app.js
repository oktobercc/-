const API_KEY = '$2a$10$1jLLuxJHp1ItkhyjiSobF.OXWtupctQqBui80XdP.f.DfkuQ7uQzu'; // 从 API Keys 页面获取
const BIN_ID = '6a625757f5f4af5e29b792c9'; // 从创建后的地址或详情页获取

// 修改保存函数
async function save() {
  // 保存到本地
  localStorage.setItem("books", JSON.stringify(books));
  console.log("已保存到本地");
  
  // 同步到云端
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': API_KEY // 使用你的 Master Key
      },
      body: JSON.stringify(books) // 直接发送书籍数据
    });
    
    if (response.ok) {
      console.log("已同步到云端");
    } else {
      console.warn("云端同步失败，状态码:", response.status);
    }
  } catch (e) {
    console.warn("云端同步失败", e);
  }
}

// 修改加载函数
async function loadFromCloud() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      headers: {
        'X-Master-Key': API_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      // JSONBin 返回的数据在 record 字段中
      if (data.record && Array.isArray(data.record)) {
        books = data.record;
        localStorage.setItem("books", JSON.stringify(books));
        render();
        return true;
      }
    }
  } catch (e) {
    console.warn("从云端加载失败", e);
  }
  return false;
}

// 修改初始化函数
async function init() {
  const loaded = await loadFromCloud();
  if (!loaded) {
    books = JSON.parse(localStorage.getItem("books") || "[]");
    render();
  }
}

// 将页面加载的 render() 改为 init()
// render(); // 注释掉这行
// init();  // 添加这行

let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let currentIndex = -1;
let startTime = null;
let rendition;

/* 保存 */
function save() {
  localStorage.setItem("books", JSON.stringify(books));
}

/* 视图切换 */
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view).classList.add('active');
}

/* 主题切换 */
function toggleTheme() {
  document.body.classList.toggle('dark');
}

/* 添加书 */
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
    附件: "",
    epub: ""
  };
  
  books.push(newBook);
  save();
  render();
  
  // 打开详情页编辑新书
  const index = books.length - 1;
  openDetail(index);
}

/* 渲染卡片 */
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

/* 打开详情 */
function openDetail(index) {
  currentIndex = index;
  currentBook = books[index];
  
  const d = document.getElementById("drawer");
  const c = document.getElementById("drawerContent");

  const statusOptions = ['未读', '在读', '已读', '弃读'];
  const statusSelect = statusOptions.map(s => 
    `<option value="${s}" ${currentBook.阅读状态 === s ? 'selected' : ''}>${s}</option>`
  ).join('');

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

    <label>📎 附件链接</label>
    <input value="${currentBook.附件 || ''}" 
      oninput="updateField('附件',this.value)" placeholder="附件URL" />

    <label>📱 EPUB文件链接</label>
    <input value="${currentBook.epub || ''}" 
      oninput="updateField('epub',this.value)" placeholder="epub文件URL" />

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

/* 创建输入字段 */
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

/* 更新字段 */
function updateField(field, value) {
  if (currentBook) {
    currentBook[field] = value;
    save();
  }
}

/* 更新标签 */
function updateTags(val) {
  if (currentBook) {
    currentBook.标签 = val.split(',').map(t => t.trim()).filter(t => t);
    save();
  }
}

/* 上传封面 */
function uploadCover(e) {
  const file = e.target.files[0];
  if (!file || !currentBook) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    currentBook.封面 = event.target.result;
    save();
    render();
    // 刷新详情页
    if (currentIndex >= 0) {
      openDetail(currentIndex);
    }
  };
  reader.readAsDataURL(file);
}

/* 关闭抽屉 */
function closeDrawer() {
  document.getElementById("drawer").classList.add("hidden");
}

/* 删除书籍 */
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

/* 阅读器 */
function openReader() {
  if (!currentBook) return;

  if (!currentBook.epub) {
    const url = prompt("请输入epub文件链接：");
    if (!url) return;
    currentBook.epub = url;
    save();
  }

  const reader = document.getElementById("reader");
  reader.classList.remove("hidden");

  try {
    const book = ePub(currentBook.epub);
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
    alert("无法加载epub文件，请检查链接是否正确。");
    console.error(e);
  }
}

/* 关闭阅读器 */
function closeReader() {
  document.getElementById("reader").classList.add("hidden");

  if (startTime && currentBook) {
    const duration = (Date.now() - startTime) / 1000;
    currentBook.阅读时长 = (currentBook.阅读时长 || 0) + duration;
    save();
    startTime = null;
  }
}

/* 搜索 */
function searchBooks() {
  const q = document.getElementById("search").value.toLowerCase();
  document.querySelectorAll(".card").forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? "block" : "none";
  });
}

/* 初始化 */
render();
