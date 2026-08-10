// Raw IndexedDB wrapper — no server, no REST round-trip. Everything the
// app persists (the calibration baseline, per-session summaries) lives
// on-device in this one database so the app works fully offline and
// survives reloads until the user explicitly recalibrates or clears data.

const DB_NAME = 'speechbio';
const DB_VERSION = 1;

export const STORE_CALIBRATION = 'calibration';
export const STORE_SESSIONS = 'sessions';
export const CALIBRATION_KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CALIBRATION)) {
        db.createObjectStore(STORE_CALIBRATION);
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        sessions.createIndex('byDate', 'dateKey');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function idbPut<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetAllByIndex<T>(storeName: string, indexName: string, query: IDBValidKey): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).index(indexName).getAll(query);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}
