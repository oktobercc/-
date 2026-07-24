/* =====================================================
   Reading OS
   Storage System

   localStorage:
   保存书籍信息

   IndexedDB:
   保存电子书文件
   保存封面图片 (新增)
===================================================== */



const DB_NAME = "ReadingOS_DB";
const DB_VERSION = 2; // 升级到版本2，新增封面存储

const STORE_NAME = "books_files";
const COVER_STORE_NAME = "books_covers";





// ===============================
// localStorage
// ===============================


function getBooks() {
  return JSON.parse(
    localStorage.getItem("books") || "[]"
  );
}





function saveBooks(books) {
  localStorage.setItem(
    "books",
    JSON.stringify(books)
  );
}





// ===============================
// IndexedDB 初始化
// ===============================


function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (e) {
      const db = e.target.result;

      // 创建文件存储（如果不存在）
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      // 创建封面存储（如果不存在）
      if (!db.objectStoreNames.contains(COVER_STORE_NAME)) {
        db.createObjectStore(COVER_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = function (e) {
      resolve(e.target.result);
    };

    request.onerror = function () {
      reject("数据库打开失败");
    };
  });
}





// ===============================
// 保存电子书文件
// ===============================


async function saveFile(bookId, file) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({ id: bookId, file: file });

    transaction.oncomplete = function () {
      resolve(true);
    };

    transaction.onerror = function () {
      reject(false);
    };
  });
}





// ===============================
// 获取电子书文件
// ===============================


async function getFile(bookId) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(bookId);

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject(null);
    };
  });
}





// ===============================
// 删除电子书文件
// ===============================


async function deleteFile(bookId) {
  const db = await openDB();

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(bookId);

    transaction.oncomplete = () => resolve(true);
  });
}





// ===============================
// 保存封面图片 (Blob)
// ===============================


async function saveCover(bookId, coverBlob) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COVER_STORE_NAME, "readwrite");
    const store = transaction.objectStore(COVER_STORE_NAME);
    store.put({ id: bookId, cover: coverBlob });

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(false);
  });
}





// ===============================
// 获取封面图片 (Blob)
// ===============================


async function getCover(bookId) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COVER_STORE_NAME, "readonly");
    const store = transaction.objectStore(COVER_STORE_NAME);
    const request = store.get(bookId);

    request.onsuccess = () => {
      resolve(request.result ? request.result.cover : null);
    };

    request.onerror = () => reject(null);
  });
}





// ===============================
// 删除封面图片
// ===============================


async function deleteCover(bookId) {
  const db = await openDB();

  return new Promise((resolve) => {
    const transaction = db.transaction(COVER_STORE_NAME, "readwrite");
    transaction.objectStore(COVER_STORE_NAME).delete(bookId);

    transaction.oncomplete = () => resolve(true);
  });
}





// ===============================
// 添加书籍
// ===============================


async function addBook(book, file) {
  const books = getBooks();
  books.push(book);
  saveBooks(books);

  if (file) {
    await saveFile(book.id, file);
  }

  return book;
}





// ===============================
// 更新书籍
// ===============================


function updateBook(updatedBook) {
  const books = getBooks();
  const index = books.findIndex(b => b.id === updatedBook.id);

  if (index !== -1) {
    books[index] = updatedBook;
    saveBooks(books);
  }
}





// ===============================
// 删除书籍 (同时删除文件和封面)
// ===============================


async function deleteBook(id) {
  // 删除 localStorage 中的书籍记录
  let books = getBooks();
  books = books.filter(b => b.id !== id);
  saveBooks(books);

  // 删除文件
  await deleteFile(id);

  // 删除封面
  await deleteCover(id);
}





// ===============================
// 获取单本书
// ===============================


function getBookById(id) {
  const books = getBooks();
  return books.find(b => b.id === id);
}





// ===============================
// 更新阅读进度
// ===============================


function updateProgress(id, progress) {
  const book = getBookById(id);
  if (book) {
    book.progress = progress;
    updateBook(book);
  }
}





// ===============================
// 保存阅读位置
// ===============================


function savePosition(id, position) {
  const book = getBookById(id);
  if (book) {
    book.position = position;
    updateBook(book);
  }
}





// ===============================
// 保存笔记
// ===============================


function addNote(id, note) {
  const book = getBookById(id);
  if (!book.notes) {
    book.notes = [];
  }
  book.notes.push({
    text: note,
    time: new Date().toLocaleString()
  });
  updateBook(book);
}





// ===============================
// 清空所有数据
// ===============================


async function clearStorage() {
  // 清空 localStorage
  localStorage.removeItem("books");

  // 清空 IndexedDB 所有存储
  const db = await openDB();

  // 清空文件存储
  let transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();

  // 清空封面存储
  transaction = db.transaction(COVER_STORE_NAME, "readwrite");
  transaction.objectStore(COVER_STORE_NAME).clear();
}





// ===============================
// 导出函数到 window
// ===============================


window.getBooks = getBooks;
window.saveBooks = saveBooks;
window.addBook = addBook;
window.updateBook = updateBook;
window.deleteBook = deleteBook;
window.getBookById = getBookById;
window.saveFile = saveFile;
window.getFile = getFile;
window.saveCover = saveCover;
window.getCover = getCover;
window.deleteCover = deleteCover;
window.updateProgress = updateProgress;
window.savePosition = savePosition;
window.addNote = addNote;
window.clearStorage = clearStorage;