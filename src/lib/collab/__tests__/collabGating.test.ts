import { describe, it, expect } from "vitest";
import { canEditCollab } from "../collabGating";

describe("canEditCollab", () => {
  it("서버 synced 면 항상 편집 허용", () => {
    expect(canEditCollab({ synced: true, idbLoaded: false, docNotEmpty: false })).toBe(true);
    expect(canEditCollab({ synced: true, idbLoaded: true, docNotEmpty: true })).toBe(true);
  });
  it("로컬 로드 + 콘텐츠 있으면 편집 허용(재방문 즉시 편집)", () => {
    expect(canEditCollab({ synced: false, idbLoaded: true, docNotEmpty: true })).toBe(true);
  });
  it("로컬 로드됐지만 doc 이 비어 있으면 차단(첫 방문 빈 doc 오편집 방지)", () => {
    expect(canEditCollab({ synced: false, idbLoaded: true, docNotEmpty: false })).toBe(false);
  });
  it("아무것도 준비 안 됐으면 차단", () => {
    expect(canEditCollab({ synced: false, idbLoaded: false, docNotEmpty: false })).toBe(false);
  });
});
