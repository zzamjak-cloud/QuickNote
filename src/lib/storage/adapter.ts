// Zustand StateStorage 호환 KV 스토리지 인터페이스
export interface KVStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
