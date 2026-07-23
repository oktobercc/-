let books = JSON.parse(localStorage.getItem("books") || "[]");
let currentBook = null;
let book, rendition;

const grid = document.getElementById("grid");
const drawer = document.getElementById("drawer");
const detail = document.getElementById("detail");

function save() {
  localStorage.setItem("books", JSON.stringify(books));
}

function render() {
  grid.innerHTML = "";

  books.forEach((b, i) => {
    const el = document.createElement("div");
    el.className = "card";

    el.innerHTML = `
      <img src="${b.cover || 'https://via.placeholder.com/150'}"/>
      <div class="info">
        <div>${b.title}</div>
        <small>${b.author || ""}</small>
      </div>
    `;

    el.onclick = () => openDetail(i);
    grid.appendChild(el);
  });
}

function openDetail(i) {
  currentBook = books[i];

  detail.innerHTML = `
    <h2>${currentBook.title}</h2>
    <p>${currentBook.author || ""}</p>
    <p>${currentBook.desc || ""}</p>
    <p>标签：${currentBook.tags || ""}</p>
    <p>进度：${currentBook.progress || 0}%</p>
  `;

  drawer.classList.remove("hidden");
}

document.getElementById("closeDrawer").onclick = () => {
  drawer.classList.add("hidden");
};

/* 添加书 */
document.getElementById("addBtn").onclick = () => {
  const title = prompt("书名");
  if (!title) return;

  books.push({
    title,
    cover: "",
    progress: 0
  });

  save();
  render();
};

/* 搜索 */
document.getElementById("search").oninput = (e) => {
  const val = e.target.value.toLowerCase();
  document.querySelectorAll(".card").forEach(card => {
    card.style.display = card.innerText.toLowerCase().includes(val) ? "" : "none";
  });
};

/* 夜间模式 */
document.getElementById("toggleTheme").onclick = () => {
  document.body.classList.toggle("dark");
};

/* EPUB */
document.getElementById("uploadEpub").onchange = function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  loadBook(url);
};

function loadBook(url) {
  book = ePub(url);
  rendition = book.renderTo("reader", {
    width: "100%",
    height: 400
  });
  rendition.display();
}

/* 翻页 */
function nextPage() {
  rendition?.next();
}

function prevPage() {
  rendition?.prev();
}

render();
