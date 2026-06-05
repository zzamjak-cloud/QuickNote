import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyWorkspaceSwitch,
  clearWorkspaceScopedStores,
  refreshWorkspaceSnapshot,
  workspaceCacheNeedsPrepaintClear,
  workspaceHasPageContentCache,
  workspaceHasStructureCache,
} from "../../lib/sync/workspaceSwitch";
import { usePageStore } from "../../store/pageStore";
import { usePageMetaRemoteStore } from "../../store/pageMetaRemoteStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { markLocallyDeletedEntity } from "../../lib/sync/localDeleteGuards";

// runtime.getSyncEngine 을 mock 하여 outbox 상태(peekPending)를 제어한다.
vi.mock("../../lib/sync/runtime", () => {
  let pending = 0;
  let snapshot: Array<{ workspaceId?: string | null }> | null = null;
  return {
    __setPending: (n: number) => {
      pending = n;
      snapshot = null;
    },
    __setSnapshot: (items: Array<{ workspaceId?: string | null }> | null) => {
      snapshot = items;
    },
    getSyncEngine: async () => ({
      peekPending: async () => pending,
      debugSnapshot: async () =>
        snapshot ?? Array.from({ length: pending }, () => ({ workspaceId: "ws-pending" })),
    }),
  };
});

import * as runtime from "../../lib/sync/runtime";
const runtimeMock = runtime as unknown as {
  __setPending: (n: number) => void;
  __setSnapshot: (items: Array<{ workspaceId?: string | null }> | null) => void;
};
const setPending = runtimeMock.__setPending;
const setSnapshot = runtimeMock.__setSnapshot;

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  usePageMetaRemoteStore.setState({ nextTokenByWorkspaceId: {}, loadingByWorkspaceId: {} });
  useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
  useSettingsStore.setState({ tabs: [{ pageId: null }], activeTabIndex: 0 });
  useBlockCommentStore.setState({ messages: [] });
  setPending(0);
  setSnapshot(null);
});

describe("applyWorkspaceSwitch", () => {
  it("초기 부트스트랩(prev=null)에서 현재 워크스페이스 캐시임이 확인되면 유지한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("initial-bootstrap");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("초기 부트스트랩(prev=null)에서 워크스페이스를 알 수 없는 구버전 캐시는 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: null });
    useSettingsStore.setState({
      tabs: [{ pageId: Object.keys(usePageStore.getState().pages)[0] ?? null }],
      activeTabIndex: 0,
    });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
    expect(usePageStore.getState().cacheWorkspaceId).toBe("ws-1");
    expect(useSettingsStore.getState().tabs).toEqual([{ pageId: null }]);
  });

  it("초기 부트스트랩(prev=null)에서 다른 워크스페이스 캐시는 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-old" });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
  });

  it("초기 부트스트랩(prev=null)에서 일부 store 캐시 소속이 불명확하면 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: null });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "x", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
    expect(useDatabaseStore.getState().databases).toEqual({});
  });

  it("동일 워크스페이스 ID 일 때는 캐시를 유지한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    const result = await applyWorkspaceSwitch("ws-1", "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("same-workspace");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("워크스페이스 스냅샷 복원 시 댓글도 함께 복원한다", async () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      activePageId: "page-1",
      pages: {
        "page-1": {
          id: "page-1",
          title: "페이지",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    useBlockCommentStore.setState({
      messages: [
        {
          id: "comment-1",
          workspaceId: "ws-1",
          pageId: "page-1",
          blockId: "block-1",
          authorMemberId: "member-1",
          bodyText: "댓글",
          mentionMemberIds: [],
          parentId: null,
          createdAt: 1,
        },
      ],
    });
    refreshWorkspaceSnapshot("ws-1");

    usePageStore.setState({
      cacheWorkspaceId: "ws-2",
      activePageId: null,
      pages: {},
    });
    useBlockCommentStore.setState({ messages: [] });

    const result = await applyWorkspaceSwitch("ws-2", "ws-1");
    expect(result.reason).toBe("restored-snapshot");
    expect(usePageStore.getState().pages["page-1"]).toBeDefined();
    expect(useBlockCommentStore.getState().messages).toHaveLength(1);
    expect(useBlockCommentStore.getState().messages[0]?.bodyText).toBe("댓글");
  });

  it("워크스페이스 스냅샷 복원 시 로컬에서 삭제한 페이지는 되살리지 않는다", async () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      activePageId: "page-1",
      pages: {
        "page-1": {
          id: "page-1",
          workspaceId: "ws-1",
          title: "아트 직군 살롱 지식 DB",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          createdAt: 0,
          updatedAt: Date.now() - 1_000,
        },
      },
    });
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1" }],
      activeTabIndex: 0,
    });
    refreshWorkspaceSnapshot("ws-1");
    markLocallyDeletedEntity("page", "page-1", "ws-1", Date.now());

    usePageStore.setState({
      cacheWorkspaceId: "ws-2",
      activePageId: null,
      pages: {},
    });
    useSettingsStore.setState({
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
    });

    const result = await applyWorkspaceSwitch("ws-2", "ws-1");

    expect(result.reason).toBe("restored-snapshot");
    expect(usePageStore.getState().pages["page-1"]).toBeUndefined();
    expect(usePageStore.getState().activePageId).toBe(null);
    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: null,
      databaseId: null,
    });
  });

  it("LC 스케줄러 워크스페이스도 일반 페이지와 스케줄러 페이지/DB 스냅샷을 복원한다", async () => {
    usePageStore.setState({
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      activePageId: "lc-page-1",
      pages: {
        "lc-page-1": {
          id: "lc-page-1",
          title: "LC 스케줄러",
          doc: {
            type: "doc",
            content: [
              {
                type: "databaseBlock",
                attrs: {
                  databaseId: "lc-scheduler-db:lc-scheduler-global",
                  layout: "inline",
                },
              },
            ],
          },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        "scheduler-row-1": {
          id: "scheduler-row-1",
          title: "일정",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          databaseId: "lc-scheduler-db:lc-scheduler-global",
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    useDatabaseStore.setState({
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      databases: {
        "lc-scheduler-db:lc-scheduler-global": {
          meta: {
            id: "lc-scheduler-db:lc-scheduler-global",
            title: "LC스케줄러",
            createdAt: 0,
            updatedAt: 0,
          },
          columns: [],
          rowPageOrder: ["scheduler-row-1"],
        },
      },
    });
    refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID);

    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      activePageId: null,
      pages: {},
    });
    useDatabaseStore.setState({ cacheWorkspaceId: "ws-1", databases: {} });

    const result = await applyWorkspaceSwitch("ws-1", LC_SCHEDULER_WORKSPACE_ID);
    expect(result.reason).toBe("restored-snapshot");
    expect(usePageStore.getState().pages["lc-page-1"]).toBeDefined();
    expect(usePageStore.getState().activePageId).toBe("lc-page-1");
    expect(usePageStore.getState().pages["scheduler-row-1"]).toBeDefined();
    expect(useDatabaseStore.getState().databases["lc-scheduler-db:lc-scheduler-global"]).toBeDefined();
  });

  it("LC 스케줄러 전환 클리어 시 현재 열린 스케줄러 행 페이지는 유지한다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      activePageId: "scheduler-row-1",
      pages: {
        "normal-page": {
          id: "normal-page",
          title: "일반 페이지",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        "scheduler-row-1": {
          id: "scheduler-row-1",
          title: "일정",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          databaseId: "lc-scheduler-db:lc-scheduler-global",
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    useSettingsStore.setState({
      tabs: [{ pageId: "scheduler-row-1" }],
      activeTabIndex: 0,
    });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "normal-db": {
          meta: { id: "normal-db", title: "일반 DB", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
        "lc-scheduler-db:lc-scheduler-global": {
          meta: {
            id: "lc-scheduler-db:lc-scheduler-global",
            title: "LC스케줄러",
            createdAt: 0,
            updatedAt: 0,
          },
          columns: [],
          rowPageOrder: ["scheduler-row-1"],
        },
      },
    });

    clearWorkspaceScopedStores(LC_SCHEDULER_WORKSPACE_ID);

    expect(usePageStore.getState().pages["normal-page"]).toBeUndefined();
    expect(usePageStore.getState().pages["scheduler-row-1"]).toBeDefined();
    expect(usePageStore.getState().activePageId).toBe("scheduler-row-1");
    expect(useSettingsStore.getState().tabs).toEqual([{ pageId: "scheduler-row-1" }]);
    expect(useDatabaseStore.getState().databases["normal-db"]).toBeUndefined();
    expect(useDatabaseStore.getState().databases["lc-scheduler-db:lc-scheduler-global"]).toBeDefined();
  });

  it("outbox pending 이 0 이면 다른 워크스페이스 전환 시 클리어를 fetch 적용 시점으로 미룬다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "x", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });
    setPending(0);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("deferred-switch");
    expect(usePageStore.getState().cacheWorkspaceId).toBe("ws-1");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
    expect(useDatabaseStore.getState().databases["db-1"]).toBeDefined();
  });

  it("outbox 에 pending 이 있으면 클리어를 보류한다 (데이터 손실 방지)", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    setPending(2);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-outbox");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("LC 스케줄러 공용 캐시만 있으면 현재 워크스페이스 prepaint 차단 대상으로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "lc-scheduler-global",
      pages: {
        "row-1": {
          id: "row-1",
          title: "일정",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          databaseId: "lc-scheduler-db:lc-scheduler-global",
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    useDatabaseStore.setState({
      cacheWorkspaceId: "lc-scheduler-global",
      databases: {
        "lc-scheduler-db:lc-scheduler-global": {
          meta: {
            id: "lc-scheduler-db:lc-scheduler-global",
            title: "LC스케줄러",
            createdAt: 0,
            updatedAt: 0,
          },
          columns: [],
          rowPageOrder: ["row-1"],
        },
      },
    });

    expect(workspaceCacheNeedsPrepaintClear("ws-1")).toBe(false);
  });

  it("LC 스케줄러 공용 outbox 만 있으면 캐시 클리어 보류 사유에서 제외한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    setSnapshot([{ workspaceId: "lc-scheduler-global" }]);

    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("deferred-switch");
    expect(result.pending).toBe(0);
  });

  it("DB 캐시만 남아 있으면 페이지 콘텐츠 캐시로 보지 않는다", () => {
    usePageStore.setState({ pages: {}, cacheWorkspaceId: "ws-1" });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            workspaceId: "ws-1",
            title: "DB",
            createdAt: 0,
            updatedAt: 0,
          },
          columns: [],
          rowPageOrder: [],
        },
      },
    });

    expect(workspaceHasPageContentCache("ws-1")).toBe(false);
  });

  it("메타 baseline placeholder(contentLoaded=false)는 페이지 콘텐츠 캐시로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      pages: {
        "meta-only": {
          id: "meta-only",
          workspaceId: "ws-1",
          title: "메타만 있음",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
          contentLoaded: false,
        },
      },
    });

    expect(workspaceHasPageContentCache("ws-1")).toBe(false);
  });

  it("구버전 빈 placeholder(contentLoaded 누락)는 페이지 콘텐츠 캐시로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      pages: {
        "legacy-empty": {
          id: "legacy-empty",
          workspaceId: "ws-1",
          title: "본문 플래그 누락",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });

    expect(workspaceHasPageContentCache("ws-1")).toBe(false);
  });

  it("본문이 로드된 단일 페이지는 워크스페이스 구조 캐시로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      pages: {
        "loaded-page": {
          id: "loaded-page",
          workspaceId: "ws-1",
          title: "본문 있음",
          icon: null,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "본문" }],
              },
            ],
          },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
          contentLoaded: true,
        },
      },
    });

    expect(workspaceHasPageContentCache("ws-1")).toBe(true);
    expect(workspaceHasStructureCache("ws-1")).toBe(false);
  });

  it("page meta 배치가 남아 있으면 워크스페이스 구조 캐시로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      pages: {
        "meta-page": {
          id: "meta-page",
          workspaceId: "ws-1",
          title: "메타",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
          contentLoaded: false,
        },
      },
    });
    usePageMetaRemoteStore.setState({
      nextTokenByWorkspaceId: { "ws-1": "next-token" },
      loadingByWorkspaceId: {},
    });

    expect(workspaceHasStructureCache("ws-1")).toBe(false);
  });

  it("page meta 배치가 완료되면 워크스페이스 구조 캐시로 본다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "ws-1",
      pages: {
        "meta-page": {
          id: "meta-page",
          workspaceId: "ws-1",
          title: "메타",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
          contentLoaded: false,
        },
      },
    });
    usePageMetaRemoteStore.setState({
      nextTokenByWorkspaceId: { "ws-1": null },
      loadingByWorkspaceId: {},
    });

    expect(workspaceHasStructureCache("ws-1")).toBe(true);
  });
});
