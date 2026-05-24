// 커스텀 페이지 아이콘을 IndexedDB에 저장 (localStorage 대비 구조적 안정성)

const DB_NAME = "quicknote-icon-cache";
const DB_VERSION = 1;
const STORE = "custom-icons";

export type CustomIconPreset = {
  id: string;
  src: string;
  label: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCustomIcons(): Promise<CustomIconPreset[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as CustomIconPreset[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return migrateFromLocalStorage();
  }
}

export async function saveCustomIcons(items: CustomIconPreset[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const item of items) store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB 실패 시 localStorage 폴백
    window.localStorage.setItem(LS_KEY, JSON.stringify(items));
  }
}

export async function addCustomIcon(item: CustomIconPreset): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const prev = JSON.parse(window.localStorage.getItem(LS_KEY) ?? "[]") as CustomIconPreset[];
    window.localStorage.setItem(LS_KEY, JSON.stringify([item, ...prev].slice(0, 80)));
  }
}

export async function deleteCustomIcon(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const prev = JSON.parse(window.localStorage.getItem(LS_KEY) ?? "[]") as CustomIconPreset[];
    window.localStorage.setItem(LS_KEY, JSON.stringify(prev.filter((i) => i.id !== id)));
  }
}

// localStorage → IndexedDB 마이그레이션 (최초 1회)
const LS_KEY = "quicknote.customPageIcons.v1";

async function migrateFromLocalStorage(): Promise<CustomIconPreset[]> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as CustomIconPreset[];
    if (items.length > 0) {
      await saveCustomIcons(items);
      window.localStorage.removeItem(LS_KEY);
    }
    return items;
  } catch {
    return [];
  }
}
