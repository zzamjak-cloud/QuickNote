import type { KVStorage } from "./adapter";

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "QuotaExceededError" || error.code === 22;
}

const LARGE_CACHE_KEYS = new Set([
  "quicknote.organizations.cache.v1",
  "quicknote.teams.cache.v1",
]);

export const webStorage: KVStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      if (LARGE_CACHE_KEYS.has(key)) {
        try {
          localStorage.removeItem(key);
          localStorage.setItem(key, value);
          return;
        } catch (retryError) {
          console.warn("[storage] quota exceeded while rewriting cache key", key, retryError);
          return;
        }
      }
      throw error;
    }
  },
  removeItem: (key) => localStorage.removeItem(key),
};
