const DB_NAME = "75hard-db";
const DB_VERSION = 1;
const STATE_KEY = "state";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
        store.createIndex("byAttemptDay", ["attemptId", "day"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function defaultState() {
  return {
    attempts: [
      { id: 1, startDate: todayISO(), status: "active", failedOnDay: null, days: {} },
    ],
    currentAttemptId: 1,
    nextAttemptId: 2,
    books: [],
    currentBookId: null,
    nextBookId: 1,
  };
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

async function loadState() {
  const store = await tx("kv", "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(STATE_KEY);
    req.onsuccess = () => resolve(req.result || defaultState());
    req.onerror = () => reject(req.error);
  });
}

async function saveState(state) {
  const store = await tx("kv", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(state, STATE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function savePhoto({ attemptId, day, blob }) {
  const store = await tx("photos", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add({ attemptId, day, blob, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPhotosForAttempt(attemptId) {
  const store = await tx("photos", "readonly");
  const idx = store.index("byAttemptDay");
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([attemptId, -Infinity], [attemptId, Infinity]);
    const results = [];
    const req = idx.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results.sort((a, b) => a.day - b.day));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function getPhotoForDay(attemptId, day) {
  const photos = await getPhotosForAttempt(attemptId);
  return photos.find((p) => p.day === day) || null;
}

async function deletePhoto(id) {
  const store = await tx("photos", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
