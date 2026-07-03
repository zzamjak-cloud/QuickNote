// 서버 "페이지 없음"(getPage=null) 자기치유 — 영구삭제된 페이지의 stale 캐시 정리 회귀 테스트.
import { describe, it, expect, beforeEach, vi } from "vitest";

const pendingPages = new Set<string>();

vi.mock("../../lib/sync/runtime", () => ({
  getSyncEngine: async () => ({
    getPendingUpsertEntityIds: async () => ({
      pages: pendingPages,
      databases: new Set<string>(),
    }),
  }),
  enqueueAsync: () => {},
}));

import {
  applyRemotePageToStore,
  pruneServerMissingPageFromCache,
} from "../../lib/sync/storeApply";
import { usePageStore } from "../../store/pageStore";
import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { GqlPage } from "../../lib/sync/graphql/operations";

function gqlPage(ws: string, id: string): GqlPage {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: ws,
    createdByMemberId: "mem",
    title: "T",
    order: "0",
    doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    createdAt: now,
    updatedAt: now,
  };
}

// 유령 페이지 시나리오: 오래전 마지막 수정(신생 가드 통과) 상태로 만든다.
function agePage(id: string, ageMs: number): void {
  usePageStore.setState((s) => ({
    pages: {
      ...s.pages,
      [id]: {
        ...s.pages[id]!,
        createdAt: Date.now() - ageMs,
        updatedAt: Date.now() - ageMs,
      },
    },
  }));
}

describe("pruneServerMissingPageFromCache", () => {
  beforeEach(() => {
    localStorage.clear();
    pendingPages.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a", workspaces: [] });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
    usePageContentLoadStore.getState().clear();
  });

  it("서버에 없는 오래된 캐시 페이지는 제거하고 activePageId 를 해제한다", async () => {
    applyRemotePageToStore(gqlPage("ws-a", "ghost-1"));
    agePage("ghost-1", 60 * 60 * 1000);
    usePageStore.setState({ activePageId: "ghost-1" });

    const pruned = await pruneServerMissingPageFromCache("ghost-1", "ws-a");

    expect(pruned).toBe(true);
    expect(usePageStore.getState().pages["ghost-1"]).toBeUndefined();
    expect(usePageStore.getState().activePageId).toBeNull();
  });

  it("방금 만들어진(신생) 페이지는 오인 삭제하지 않는다", async () => {
    applyRemotePageToStore(gqlPage("ws-a", "fresh-1"));

    const pruned = await pruneServerMissingPageFromCache("fresh-1", "ws-a");

    expect(pruned).toBe(false);
    expect(usePageStore.getState().pages["fresh-1"]).toBeDefined();
  });

  it("outbox 업로드 대기 중인 페이지는 보류한다", async () => {
    applyRemotePageToStore(gqlPage("ws-a", "pending-1"));
    agePage("pending-1", 60 * 60 * 1000);
    pendingPages.add("pending-1");

    const pruned = await pruneServerMissingPageFromCache("pending-1", "ws-a");

    expect(pruned).toBe(false);
    expect(usePageStore.getState().pages["pending-1"]).toBeDefined();
  });

  it("로컬에 없는 페이지는 아무것도 하지 않는다", async () => {
    const pruned = await pruneServerMissingPageFromCache("nope-1", "ws-a");
    expect(pruned).toBe(false);
  });
});
