import { describe, it, expect, afterEach } from "vitest";
import { isCollabEnabledForPage, buildCollabWsUrl, isCollabEnabledForDatabase, buildDbCollabWsUrl } from "../collabConfig";

describe("collabConfig", () => {
  const orig = { ...import.meta.env };
  afterEach(() => {
    Object.assign(import.meta.env, orig);
  });

  it("WS URL 미설정이면 페이지가 allowlist 에 있어도 비활성", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "";
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_ENABLED_PAGE_IDS = "p1";
    expect(isCollabEnabledForPage("p1")).toBe(false);
  });

  it("allowlist 에 포함된 pageId 만 활성", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "wss://x/dev";
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_ENABLED_PAGE_IDS = "p1, p2";
    expect(isCollabEnabledForPage("p1")).toBe(true);
    expect(isCollabEnabledForPage("p2")).toBe(true);
    expect(isCollabEnabledForPage("p3")).toBe(false);
  });

  it('allowlist 가 "*" 이면 모든 페이지 활성(WS URL 있을 때)', () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "wss://x/dev";
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_ENABLED_PAGE_IDS = "*";
    expect(isCollabEnabledForPage("anything")).toBe(true);
  });

  it("buildCollabWsUrl 은 token·pageId 를 쿼리스트링으로 인코딩", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "wss://x/dev";
    const url = buildCollabWsUrl("p1", "tok en/+=");
    expect(url).toContain("pageId=p1");
    expect(url).toContain("token=tok%20en%2F%2B%3D");
  });

  it("VITE_COLLAB_ENABLED_DB_IDS 에 포함된 DB 만 협업 활성", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "wss://x/dev";
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_ENABLED_DB_IDS = "db-1, db-2";
    expect(isCollabEnabledForDatabase("db-1")).toBe(true);
    expect(isCollabEnabledForDatabase("db-3")).toBe(false);
  });
  it("WS URL 없으면 DB 협업 비활성", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "";
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_ENABLED_DB_IDS = "*";
    expect(isCollabEnabledForDatabase("db-1")).toBe(false);
  });
  it("buildDbCollabWsUrl 은 db: prefix room 을 pageId 파라미터에 싣는다", () => {
    (import.meta.env as Record<string, unknown>).VITE_COLLAB_WS_URL = "wss://x/dev";
    const url = buildDbCollabWsUrl("db-1", "tok");
    expect(url).toContain("pageId=db%3Adb-1");
    expect(url).toContain("token=tok");
  });
});
