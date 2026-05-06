import type { StateStore } from "oidc-client-ts";
import type { KVStorage } from "../storage/adapter";

// oidc-client-ts 가 요구하는 비동기 StateStore 를 zustandStorage(웹 localStorage / 데스크톱 SQLite)
// 위에 구현한다. getAllKeys 를 위해 별도 index 엔트리를 유지한다.
export class AsyncStateStore implements StateStore {
  private storage: KVStorage;
  private prefix: string;
  private indexKey: string;

  constructor(storage: KVStorage, prefix: string) {
    this.storage = storage;
    this.prefix = prefix;
    this.indexKey = `${prefix}::__keys__`;
  }

  private full(key: string): string {
    return `${this.prefix}::${key}`;
  }

  private async readIndex(): Promise<Set<string>> {
    const raw = await this.storage.getItem(this.indexKey);
    if (!raw) return new Set();
    try {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    } catch {
      return new Set();
    }
  }

  private async writeIndex(set: Set<string>): Promise<void> {
    await this.storage.setItem(this.indexKey, JSON.stringify(Array.from(set)));
  }

  async set(key: string, value: string): Promise<void> {
    await this.storage.setItem(this.full(key), value);
    const idx = await this.readIndex();
    if (!idx.has(key)) {
      idx.add(key);
      await this.writeIndex(idx);
    }
  }

  async get(key: string): Promise<string | null> {
    const raw = await this.storage.getItem(this.full(key));
    return raw ?? null;
  }

  async remove(key: string): Promise<string | null> {
    const value = await this.storage.getItem(this.full(key));
    await this.storage.removeItem(this.full(key));
    const idx = await this.readIndex();
    if (idx.delete(key)) {
      await this.writeIndex(idx);
    }
    return value ?? null;
  }

  async getAllKeys(): Promise<string[]> {
    const idx = await this.readIndex();
    return Array.from(idx);
  }
}
