import { describe, it, expect, vi } from "vitest";
import { ImageUrlCache } from "../../lib/sync/imageUrls";

describe("ImageUrlCache", () => {
  it("calls fetcher only once within TTL", async () => {
    const fetcher = vi.fn(async () => "https://signed/x");
    const cache = new ImageUrlCache(fetcher, 1000);
    const a = await cache.get("img-1");
    const b = await cache.get("img-1");
    expect(a).toBe("https://signed/x");
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    const urls = ["u1", "u2"];
    let i = 0;
    const fetcher = vi.fn(async () => urls[i++]!);
    const cache = new ImageUrlCache(fetcher, 10);
    await cache.get("img");
    await new Promise((r) => setTimeout(r, 20));
    const second = await cache.get("img");
    expect(second).toBe("u2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
