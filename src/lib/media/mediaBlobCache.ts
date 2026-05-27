// 미디어(이미지/소형 동영상) 바이트를 IndexedDB 에 로컬 캐싱한다.
// 새로고침·워크스페이스/페이지 이동 시 S3 재다운로드 없이 로컬 blob 으로 즉시 표시하기 위함.
// 총 용량은 LRU(updatedAt 기준) 로 관리한다. IndexedDB 사용 불가 환경에서는 모든 함수가 no-op.

const DB_NAME = "quicknote-media-cache";
const DB_VERSION = 1;
const STORE = "blobs";

const TOTAL_LIMIT_BYTES = 300 * 1024 * 1024; // 전체 한도 300MB
const PRUNE_TARGET_BYTES = 250 * 1024 * 1024; // prune 후 목표 250MB

/** 항목별 캐시 허용 최대 크기 */
export const IMAGE_CACHE_MAX_BYTES = 30 * 1024 * 1024; // 이미지 30MB
export const VIDEO_CACHE_MAX_BYTES = 30 * 1024 * 1024; // 소형 동영상 30MB

type MediaRecord = { id: string; blob: Blob; size: number; updatedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** 캐시된 blob 을 반환하고, LRU 갱신을 위해 updatedAt 을 best-effort 로 touch 한다. */
export async function readMediaBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => {
        const rec = req.result as MediaRecord | undefined;
        if (!rec?.blob) {
          resolve(null);
          return;
        }
        resolve(rec.blob);
        void touchMediaBlob(id);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function touchMediaBlob(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const g = store.get(id);
    g.onsuccess = () => {
      const rec = g.result as MediaRecord | undefined;
      if (rec) {
        rec.updatedAt = Date.now();
        store.put(rec);
      }
    };
  } catch {
    // touch 실패는 무시 (LRU 정확도만 약간 떨어짐)
  }
}

/** blob 을 캐싱한다. 0바이트·한도 초과는 저장하지 않는다. */
export async function writeMediaBlob(
  id: string,
  blob: Blob,
  options: { maxItemBytes: number },
): Promise<void> {
  if (!blob || blob.size === 0 || blob.size > options.maxItemBytes) return;
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const rec: MediaRecord = { id, blob, size: blob.size, updatedAt: Date.now() };
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    void pruneIfNeeded();
  } catch {
    // 저장 실패는 렌더 실패로 취급하지 않는다.
  }
}

// S3 버킷에 CORS(GET) 가 설정돼 있지 않으면 fetch 가 매번 CORS 로 막혀 콘솔이 오염되고
// 불필요한 실패 요청이 쌓인다. 첫 실패 시 세션 동안 바이트 fetch 를 비활성화해
// 이후로는 PreSignedURL <img>/<video> 직접 로딩만 사용한다.
let byteFetchDisabled = false;

/** 바이트 fetch 가 (CORS 등으로) 비활성화됐는지 */
export function isMediaByteFetchDisabled(): boolean {
  return byteFetchDisabled;
}

/** PreSignedURL 에서 바이트를 받아 Blob 으로 반환. 비활성/실패 시 null. */
export async function fetchMediaBlob(url: string): Promise<Blob | null> {
  if (byteFetchDisabled) return null;
  try {
    // cache: "reload" — <img>/<video> 가 Origin 없이 먼저 받아 ACAO 없는 응답이 HTTP 캐시에
    // 들어가면, 같은 URL 의 fetch 가 그 캐시를 받아 CORS 로 실패한다. 항상 새 CORS 요청을
    // 보내 S3 가 Access-Control-Allow-Origin 을 포함한 응답을 주도록 강제한다.
    const resp = await fetch(url, { mode: "cors", cache: "reload" });
    if (!resp.ok) return null;
    return await resp.blob();
  } catch {
    // CORS/네트워크 실패 — 세션 동안 추가 시도 차단(콘솔 스팸·중복 실패 요청 방지).
    byteFetchDisabled = true;
    return null;
  }
}

let pruning = false;

async function pruneIfNeeded(): Promise<void> {
  if (pruning) return;
  pruning = true;
  try {
    const db = await openDb();
    if (!db) return;
    const entries = await new Promise<Array<{ id: string; size: number; updatedAt: number }>>(
      (resolve) => {
        const out: Array<{ id: string; size: number; updatedAt: number }> = [];
        try {
          const cursorReq = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const v = cursor.value as MediaRecord;
              out.push({ id: v.id, size: v.size, updatedAt: v.updatedAt });
              cursor.continue();
            } else {
              resolve(out);
            }
          };
          cursorReq.onerror = () => resolve(out);
        } catch {
          resolve(out);
        }
      },
    );
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= TOTAL_LIMIT_BYTES) return;
    entries.sort((a, b) => a.updatedAt - b.updatedAt); // 오래된 것부터
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const e of entries) {
      if (total <= PRUNE_TARGET_BYTES) break;
      store.delete(e.id);
      total -= e.size;
    }
  } catch {
    // prune 실패 무시
  } finally {
    pruning = false;
  }
}
