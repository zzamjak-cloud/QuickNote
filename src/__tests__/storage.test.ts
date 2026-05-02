import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPages,
  savePages,
  loadActivePageId,
  saveActivePageId,
  STORAGE_KEYS,
} from "../lib/storage";
import type { PageMap } from "../types/page";

beforeEach(() => {
  localStorage.clear();
});

describe("storage.loadPages / savePages", () => {
  it("저장된 데이터가 없으면 빈 객체 반환", () => {
    expect(loadPages()).toEqual({});
  });

  it("savePages 후 동일 객체를 다시 읽음", () => {
    const map: PageMap = {
      a: {
        id: "a",
        title: "테스트",
        icon: null,
        doc: { type: "doc", content: [] },
        parentId: null,
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    savePages(map);
    expect(loadPages()).toEqual(map);
  });

  it("손상된 JSON 이면 빈 객체 반환", () => {
    localStorage.setItem(STORAGE_KEYS.pages, "{not json");
    expect(loadPages()).toEqual({});
  });
});

describe("storage.activePageId", () => {
  it("미설정 시 null 반환", () => {
    expect(loadActivePageId()).toBeNull();
  });

  it("설정/제거 동작", () => {
    saveActivePageId("xyz");
    expect(loadActivePageId()).toBe("xyz");
    saveActivePageId(null);
    expect(loadActivePageId()).toBeNull();
  });
});
