// useImageUrl 자가 치유 — <img> 로드 실패(reportLoadError) 시 만료 URL·blob 캐시를
// 버리고 새 PreSignedURL 로 재해석하는지, 상한 초과 시 에러로 전환하는지 검증한다.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  let urlCounter = 0;
  return {
    get: vi.fn(async () => `https://s3.example/presign-${++urlCounter}`),
    invalidate: vi.fn(() => Promise.resolve()),
    forgetMediaObjectUrl: vi.fn(),
    deleteMediaBlob: vi.fn(async () => {}),
  };
});

vi.mock("../registry", () => ({
  imageUrlCache: {
    get: mocks.get,
    peek: () => undefined,
    invalidate: mocks.invalidate,
  },
}));

// 바이트 fetch 불가 환경(fetchMediaBlob=null) — PreSignedURL 직접 <img> 경로를 재현한다.
vi.mock("../../media/mediaBlobCache", () => ({
  IMAGE_CACHE_MAX_BYTES: 1,
  fetchMediaBlob: async () => null,
  getMediaObjectUrl: async () => null,
  peekMediaObjectUrl: () => null,
  rememberMediaObjectUrl: () => "blob:unused",
  writeMediaBlob: async () => {},
  forgetMediaObjectUrl: mocks.forgetMediaObjectUrl,
  deleteMediaBlob: mocks.deleteMediaBlob,
}));

import { useImageUrl } from "../hooks";

describe("useImageUrl 자가 치유", () => {
  it("reportLoadError 시 캐시를 무효화하고 새 PreSignedURL 로 교체한다", async () => {
    const { result } = renderHook(() => useImageUrl("quicknote-image://img-1"));
    await waitFor(() =>
      expect(result.current.url).toMatch(/https:\/\/s3\.example\/presign-\d+/),
    );
    const firstUrl = result.current.url;

    act(() => result.current.reportLoadError());

    await waitFor(() => {
      expect(result.current.url).toMatch(/presign-\d+/);
      expect(result.current.url).not.toBe(firstUrl);
    });
    expect(mocks.invalidate).toHaveBeenCalledWith("img-1");
    expect(mocks.forgetMediaObjectUrl).toHaveBeenCalledWith("img-1");
    expect(mocks.deleteMediaBlob).toHaveBeenCalledWith("img-1");
    expect(result.current.error).toBeNull();
  });

  it("치유 상한 초과 시 에러 표시로 전환한다", async () => {
    const { result } = renderHook(() => useImageUrl("quicknote-image://img-2"));
    await waitFor(() => expect(result.current.url).toMatch(/presign-\d+/));

    for (let i = 0; i < 3; i++) {
      const prev = result.current;
      act(() => prev.reportLoadError());
      // 상태 반영 대기 — 마지막 시도에서는 에러로 전환된다.
      await waitFor(() =>
        expect(result.current.error !== null || result.current.url !== prev.url).toBe(true),
      );
    }
    await waitFor(() =>
      expect(result.current.error).toBe("이미지를 불러오지 못했습니다."),
    );
    expect(result.current.url).toBeNull();
  });
});
