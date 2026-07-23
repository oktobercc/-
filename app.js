let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let startTime = null;
let rendition;

/* 保存 */
function save() {
  localStorage.setItem("books", JSON.stringify(books));
}

/* 添加书（完整字段） */
function addBook() {
  books.push({
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
  });
  save();
  render();
}

/* 渲染卡片 */
function render() {
  const gallery = document.getElementById("gallery");
  gallery.innerHTML = "";

  books.forEach((b,i)=>{
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
  <img src="${b.封面 || 'https://via.placeholder.com/150'}">
      <p>${b.书名}</p>
`;

    div.onclick = ()=>openDetail(i);
    gallery.appendChild(div);
  });
}

/* 打开详情（Notion风表单） */
function openDetail(index){
  currentBook = books[index];

  const d = document.getElementById("drawer");
  const c = document.getElementById("drawerContent");

  c.innerHTML = `
    <h2 contenteditable oninput="update('书名',this.innerText)">${currentBook.书名}</h2>

    ${input("作者")}
    ${input("网址")}
    ${input("来源")}
    ${input("作品类型")}
    ${input("字数")}
    ${input("开始日期","date")}
    ${input("结束日期","date")}
    ${input("评分","number")}

    <label>标签</label>
    <input value="${currentBook.标签.join(',')}" 
      oninput="updateTags(this.value)" />

    <label>简介</label>
    <textarea oninput="update('简介',this.value)">${currentBook.简介}</textarea>

    <label>书评</label>
    <textarea oninput="update('书评',this.value)">${currentBook.书评}</textarea>

    <label>书摘</label>
    <textarea oninput="update('书摘',this.value)">${currentBook.书摘}</textarea>

    <label>附件</label>
    <input value="${currentBook.附件}" 
      oninput="update('附件',this.value)" />

    <hr>

    <p>阅读进度：${currentBook.阅读进度}%</p>
    <p>阅读时长：${Math.floor(currentBook.阅读时长/60)} 分钟</p>

    <button onclick="openReader()">📖 阅读</button>
  `;
    <button onclick="deleteBook(${currentBook.id})" style="color:red">
  🗑 删除这本书
</button>
  d.classList.remove("hidden");
}

/* 输入组件 */
function input(field,type="text"){
  return `
    <label>${field}</label>
    <input type="${type}" 
      value="${currentBook[field] || ''}"
      oninput="update('${field}',this.value)" />
  `;
}

/* 更新字段 */
function update(field,value){
  currentBook[field] = value;
  save();
}

function save() {
  localStorage.setItem("books", JSON.stringify(books));
  console.log("已保存");
}

/* 标签 */
function updateTags(val){
  currentBook.标签 = val.split(",");
  save();
}

/* 阅读器 */
function openReader(){
  if(!currentBook.epub){
    const url = prompt("输入epub链接");
    if(!url) return;
    currentBook.epub = url;
  }

  document.getElementById("reader").classList.remove("hidden");

  const book = ePub(currentBook.epub);
  rendition = book.renderTo("viewer",{width:"100%",height:"100%"});
  rendition.display();

  startTime = Date.now();

  rendition.on("relocated", loc=>{
    currentBook.阅读进度 = Math.floor(loc.start.percentage * 100);
    save();
  });
}

/* 关闭阅读器（记录时间） */
function closeReader(){
  document.getElementById("reader").classList.add("hidden");

  if(startTime){
    const duration = (Date.now() - startTime)/1000;
    currentBook.阅读时长 += duration;
    save();
  }
}

/* 搜索 */
function searchBooks(){
  const q = document.getElementById("search").value;

  document.querySelectorAll(".card").forEach(card=>{
    card.style.display = card.innerText.includes(q) ? "block":"none";
  });
}

function uploadCover(e){
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = function(){
    currentBook.封面 = reader.result; // base64
    save();
    render();
  };

  reader.readAsDataURL(file);
}

/*删除书籍*/
function deleteBook(id){
  if(!confirm("确定删除这本书吗？")) return;

  books = books.filter(b => b.id !== id);

  save();
  render();

  // 如果详情页开着，关闭
  document.getElementById("drawer").classList.add("hidden");
}

render();
