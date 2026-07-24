/* =====================================================
   Reading OS / 页间集
   Storage System  v3

   localStorage : 书籍信息 + 自建选项（来源/类型/标签）
   IndexedDB    : 电子书文件、封面、附件、书摘图片

   注意：IndexedDB 在 file:// 下会被 Chrome 拒绝，
   请用本地服务器打开（python -m http.server）。
===================================================== */

/* 下载 / 打开私密书籍时要输的口令，改这一处两边都生效 */
const DOWNLOAD_PASSWORD = "0025";

const DB_NAME = "ReadingOS_DB";
const DB_VERSION = 3;

const STORE_NAME = "books_files";      // 旧版：整本书文件（保留兼容）
const COVER_STORE_NAME = "books_covers";
const ASSET_STORE_NAME = "books_assets"; // 新：附件 / 书摘图片

/* ===============================
   基础：书籍列表
================================ */
function getBooks() {
  try {
    return JSON.parse(localStorage.getItem("books") || "[]");
  } catch (e) {
    console.error("书籍数据损坏", e);
    return [];
  }
}

function saveBooks(books) {
  localStorage.setItem("books", JSON.stringify(books));
}

function getBookById(id) {
  return getBooks().find((b) => String(b.id) === String(id));
}

/* ===============================
   自建选项库（来源 / 作品类型 / 标签）
================================ */
const DEFAULT_OPTIONS = {
  source: ["晋江文学城", "起点中文网", "番茄小说网", "实体书", "其他"],
  category: ["长篇小说", "短篇集", "散文", "非虚构", "漫画"],
  tags: ["未分类"],
};

function getOptions() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("bookOptions") || "{}");
  } catch (e) {
    saved = {};
  }
  return {
    source: saved.source || DEFAULT_OPTIONS.source.slice(),
    category: saved.category || DEFAULT_OPTIONS.category.slice(),
    tags: saved.tags || DEFAULT_OPTIONS.tags.slice(),
  };
}

function saveOptions(options) {
  localStorage.setItem("bookOptions", JSON.stringify(options));
}

/** 向某一类选项里追加一个自建项，已存在则忽略 */
function addOption(kind, value) {
  value = (value || "").trim();
  if (!value) return getOptions();

  const options = getOptions();
  if (!options[kind]) options[kind] = [];
  if (!options[kind].includes(value)) {
    options[kind].push(value);
    saveOptions(options);
  }
  return options;
}

function removeOption(kind, value) {
  const options = getOptions();
  options[kind] = (options[kind] || []).filter((v) => v !== value);
  saveOptions(options);
  return options;
}

/* ===============================
   IndexedDB
================================ */
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("浏览器不支持 IndexedDB"));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new Error("无法打开数据库，请用本地服务器打开页面（不要用 file:// 直接双击 html）"));
      return;
    }

    request.onupgradeneeded = function (e) {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(COVER_STORE_NAME)) {
        db.createObjectStore(COVER_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        const store = db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
        store.createIndex("bookId", "bookId", { unique: false });
      }
    };

    request.onsuccess = function (e) {
      resolve(e.target.result);
    };

    request.onerror = function () {
      dbPromise = null;
      reject(new Error("数据库打开失败：如果你是双击 html 打开的，浏览器会禁止本地文件访问 IndexedDB，请改用本地服务器"));
    };
  });

  return dbPromise;
}

/** 统一的事务封装 */
function withStore(storeName, mode, handler) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;

        try {
          result = handler(store);
        } catch (e) {
          reject(e);
          return;
        }

        tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        tx.onerror = () => reject(tx.error || new Error("数据库写入失败"));
        tx.onabort = () => reject(tx.error || new Error("数据库事务被中断"));
      })
  );
}

/* ===============================
   整本书文件（旧接口，保留）
================================ */
function saveFile(bookId, file) {
  return withStore(STORE_NAME, "readwrite", (store) => {
    store.put({ id: bookId, file: file });
  });
}

function getFile(bookId) {
  return withStore(STORE_NAME, "readonly", (store) => ({ __req: store.get(bookId) }));
}

function deleteFile(bookId) {
  return withStore(STORE_NAME, "readwrite", (store) => {
    store.delete(bookId);
  });
}

/* ===============================
   封面
================================ */
function saveCover(bookId, coverBlob) {
  return withStore(COVER_STORE_NAME, "readwrite", (store) => {
    store.put({ id: bookId, cover: coverBlob });
  });
}

function getCover(bookId) {
  return withStore(COVER_STORE_NAME, "readonly", (store) => ({ __req: store.get(bookId) })).then(
    (row) => (row ? row.cover : null)
  );
}

function deleteCover(bookId) {
  return withStore(COVER_STORE_NAME, "readwrite", (store) => {
    store.delete(bookId);
  });
}

/* ===============================
   资源：附件文件 / 书摘图片
   asset = { id, bookId, kind, name, mime, size, blob }
   kind: "attachment" | "excerpt"
================================ */
function newAssetId() {
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function saveAsset(asset) {
  if (!asset.id) asset.id = newAssetId();
  return withStore(ASSET_STORE_NAME, "readwrite", (store) => {
    store.put(asset);
  }).then(() => asset.id);
}

function getAsset(assetId) {
  return withStore(ASSET_STORE_NAME, "readonly", (store) => ({ __req: store.get(assetId) }));
}

function deleteAsset(assetId) {
  return withStore(ASSET_STORE_NAME, "readwrite", (store) => {
    store.delete(assetId);
  });
}

async function deleteAssetsOfBook(bookId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
    const index = tx.objectStore(ASSET_STORE_NAME).index("bookId");
    const request = index.openCursor(IDBKeyRange.only(bookId));

    request.onsuccess = function (e) {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ===============================
   书籍增删改
================================ */
async function addBook(book, file) {
  const books = getBooks();
  books.push(book);
  saveBooks(books);

  if (file) {
    await saveFile(book.id, file);
  }
  return book;
}

function updateBook(updatedBook) {
  const books = getBooks();
  const index = books.findIndex((b) => String(b.id) === String(updatedBook.id));

  if (index !== -1) {
    books[index] = updatedBook;
  } else {
    books.push(updatedBook);
  }
  saveBooks(books);
  return updatedBook;
}

async function deleteBook(id) {
  let books = getBooks();
  books = books.filter((b) => String(b.id) !== String(id));
  saveBooks(books);

  try {
    await deleteFile(id);
    await deleteCover(id);
    await deleteAssetsOfBook(id);
  } catch (e) {
    console.warn("附属数据清理失败", e);
  }
}

/* ===============================
   进度 / 位置 / 阅读时长
================================ */
function updateProgress(id, progress) {
  const book = getBookById(id);
  if (book) {
    book.progress = Math.max(0, Math.min(100, Math.round(progress)));
    updateBook(book);
  }
}

function savePosition(id, position) {
  const book = getBookById(id);
  if (book) {
    book.position = position;
    updateBook(book);
  }
}

/** 追加一条阅读记录（秒），并累加总时长 */
function addReadSession(id, startTs, endTs) {
  const book = getBookById(id);
  if (!book) return null;

  const seconds = Math.max(0, Math.round((endTs - startTs) / 1000));
  if (seconds < 1) return book;

  if (!book.sessions) book.sessions = [];
  book.sessions.push({ start: startTs, end: endTs, seconds: seconds });

  book.readSeconds = (book.readSeconds || 0) + seconds;
  book.readTime = Math.floor(book.readSeconds / 60); // 兼容旧字段（分钟）
  book.readCount = (book.readCount || 0) + 1;

  updateBook(book);
  return book;
}

function addNote(id, note) {
  const book = getBookById(id);
  if (!book) return;
  if (!book.notes) book.notes = [];
  book.notes.push({ text: note, time: new Date().toLocaleString() });
  updateBook(book);
}

async function clearStorage() {
  localStorage.removeItem("books");
  await withStore(STORE_NAME, "readwrite", (s) => s.clear());
  await withStore(COVER_STORE_NAME, "readwrite", (s) => s.clear());
  await withStore(ASSET_STORE_NAME, "readwrite", (s) => s.clear());
}

/* ===============================
   工具
================================ */
function formatDuration(totalSeconds) {
  totalSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

window.DOWNLOAD_PASSWORD = DOWNLOAD_PASSWORD;
window.getBooks = getBooks;
window.saveBooks = saveBooks;
window.getBookById = getBookById;
window.getOptions = getOptions;
window.saveOptions = saveOptions;
window.addOption = addOption;
window.removeOption = removeOption;
window.addBook = addBook;
window.updateBook = updateBook;
window.deleteBook = deleteBook;
window.saveFile = saveFile;
window.getFile = getFile;
window.saveCover = saveCover;
window.getCover = getCover;
window.deleteCover = deleteCover;
window.saveAsset = saveAsset;
window.getAsset = getAsset;
window.deleteAsset = deleteAsset;
window.deleteAssetsOfBook = deleteAssetsOfBook;
window.newAssetId = newAssetId;
window.updateProgress = updateProgress;
window.savePosition = savePosition;
window.addReadSession = addReadSession;
window.addNote = addNote;
window.clearStorage = clearStorage;
window.formatDuration = formatDuration;
window.formatSize = formatSize;
