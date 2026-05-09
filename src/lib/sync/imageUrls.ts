// PreSignedURL 캐시. 만료 직전(50분) 까지 재사용.

type Entry = { url: string; expiresAt: number };

export class ImageUrlCache {
  private cache = new Map<string, Entry>();
  private readonly fetcher: (id: string) => Promise<string>;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(
    fetcher: (id: string) => Promise<string>,
    ttlMs: number = 50 * 60 * 1000,
    clock: () => number = () => Date.now(),
  ) {
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  /** TTL 내에 이미 풀린 URL만 동기 반환 — 노드뷰 재마운트 시 로딩 깜빡임 방지 */
  peek(imageId: string): string | undefined {
    const cached = this.cache.get(imageId);
    const now = this.clock();
    if (cached && cached.expiresAt > now) return cached.url;
    return undefined;
  }

  async get(imageId: string): Promise<string> {
    const cached = this.cache.get(imageId);
    const now = this.clock();
    if (cached && cached.expiresAt > now) return cached.url;
    const url = await this.fetcher(imageId);
    this.cache.set(imageId, { url, expiresAt: now + this.ttlMs });
    return url;
  }

  invalidate(imageId: string): void {
    this.cache.delete(imageId);
  }

  clear(): void {
    this.cache.clear();
  }
}
