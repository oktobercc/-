/* =====================================================
   Reading OS
   Storage System

   localStorage: 书籍信息
   IndexedDB: 电子书文件 + 封面图片
===================================================== */

const DB_NAME = "ReadingOS_DB";
const DB_VERSION = 2;

const STORE_NAME = "books_files";
const COVER_STORE_NAME = "books_covers";

function getBooks() {
  return JSON.parse(localStorage.getItem("books") || "[]");
}

function saveBooks(books) {
  localStorage.setItem("books", JSON.stringify(books));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (e) {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

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

async function deleteFile(bookId) {
  const db = await openDB();

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(bookId);

    transaction.oncomplete = () => resolve(true);
  });
}

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

async function deleteCover(bookId) {
  const db = await openDB();

  return new Promise((resolve) => {
    const transaction = db.transaction(COVER_STORE_NAME, "readwrite");
    transaction.objectStore(COVER_STORE_NAME).delete(bookId);

    transaction.oncomplete = () => resolve(true);
  });
}

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
  const index = books.findIndex((b) => b.id === updatedBook.id);

  if (index !== -1) {
    books[index] = updatedBook;
    saveBooks(books);
  }
}

async function deleteBook(id) {
  let books = getBooks();
  books = books.filter((b) => b.id !== id);
  saveBooks(books);

  await deleteFile(id);
  await deleteCover(id);
}

function getBookById(id) {
  const books = getBooks();
  return books.find((b) => b.id === id);
}

function updateProgress(id, progress) {
  const book = getBookById(id);
  if (book) {
    book.progress = progress;
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

function addNote(id, note) {
  const book = getBookById(id);
  if (!book.notes) {
    book.notes = [];
  }
  book.notes.push({
    text: note,
    time: new Date().toLocaleString(),
  });
  updateBook(book);
}

async function clearStorage() {
  localStorage.removeItem("books");

  const db = await openDB();

  let transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();

  transaction = db.transaction(COVER_STORE_NAME, "readwrite");
  transaction.objectStore(COVER_STORE_NAME).clear();
}

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
