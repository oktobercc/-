// storage.js - IndexedDB 存储管理
const DB_NAME = 'ReadingOS';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      console.log('✅ IndexedDB 已连接');
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ IndexedDB 存储已创建');
      }
    };
  });
}

async function saveFileToIndexedDB(bookId, fileType, fileName, fileData, metadata = {}) {
  if (!db) await openDB();
  const id = `${bookId}_${fileType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const record = { id, bookId, type: fileType, fileName, data: fileData, metadata, timestamp: Date.now() };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { console.log(`✅ 文件已保存: ${fileName}`); resolve(id); };
  });
}

async function getFileFromIndexedDB(fileId) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(fileId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function deleteFileFromIndexedDB(fileId) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function getFilesForBook(bookId) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('bookId');
    const request = index.getAll(bookId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function clearFilesForBook(bookId) {
  if (!db) await openDB();
  const files = await getFilesForBook(bookId);
  for (const file of files) { await deleteFileFromIndexedDB(file.id); }
  console.log(`✅ 已清理 ${bookId} 的所有文件`);
}

async function getStorageInfo() {
  if (!db) await openDB();
  const files = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  let totalSize = 0;
  files.forEach(file => { if (file.data) { totalSize += file.data.byteLength || file.data.length || 0; } });
  return { count: files.length, totalSize: totalSize, totalSizeFormatted: formatFileSize(totalSize) };
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + units[i];
}
