import { describe, it, expect, beforeEach } from "vitest";
import {
  applyWorkspaceLanding,
  getFirstRootSidebarPageId,
} from "../../lib/sync/workspaceLanding";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { Page, PageMap } from "../../types/page";

const emptyDoc = { type: "doc" as const, content: [{ type: "paragraph" as const }] };

function makePage(over: Partial<Page> & Pick<Page, "id" | "order">): Page {
  return {
    title: "t",
    icon: null,
    doc: emptyDoc,
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("getFirstRootSidebarPageId", () => {
  const WS = "ws-1";

  it("루트 일반 페이지 중 order 가 가장 작은 id 를 반환한다", () => {
    const pages: PageMap = {
      a: makePage({ id: "a", order: 2 }),
      b: makePage({ id: "b", order: 0 }),
      c: makePage({ id: "c", order: 1 }),
    };
    expect(getFirstRootSidebarPageId(pages, WS)).toBe("b");
  });

  it("다른 워크스페이스 루트가 더 앞에 있어도 현재 워크스페이스 첫 인덱스를 반환한다", () => {
    const pages: PageMap = {
      lcMilestone: makePage({
        id: "lcMilestone",
        order: 0,
        workspaceId: "lc-scheduler",
      }),
      catIndex: makePage({ id: "catIndex", order: 1, workspaceId: WS }),
    };
    expect(getFirstRootSidebarPageId(pages, WS)).toBe("catIndex");
  });

  it("workspaceId 가 없는 레거시 LC 보호 DB 루트는 현재 워크스페이스 첫 인덱스에서 제외한다", () => {
    const pages: PageMap = {
      legacyLcRoot: makePage({
        id: "legacyLcRoot",
        order: 0,
        doc: {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                layout: "inline",
                databaseId: "lc-milestone-db:lc-scheduler-global",
              },
            },
          ],
        },
      }),
      catIndex: makePage({ id: "catIndex", order: 1, workspaceId: WS }),
    };
    expect(getFirstRootSidebarPageId(pages, WS)).toBe("catIndex");
  });

  it("자식 페이지만 있으면 null", () => {
    const pages: PageMap = {
      child: makePage({ id: "child", parentId: "p", order: 0 }),
    };
    expect(getFirstRootSidebarPageId(pages, WS)).toBeNull();
  });

  it("databaseId 가 있으면(행 페이지) 제외", () => {
    const pages: PageMap = {
      row: makePage({
        id: "row",
        order: 0,
        databaseId: "db1",
      }),
      normal: makePage({ id: "normal", order: 1 }),
    };
    expect(getFirstRootSidebarPageId(pages, WS)).toBe("normal");
  });
});

describe("applyWorkspaceLanding — forceFirstRoot", () => {
  const WS = "ws-1";
  const fullPageHomeDoc = {
    type: "doc" as const,
    content: [
      {
        type: "databaseBlock" as const,
        attrs: { layout: "fullPage", databaseId: "db1" },
      },
    ],
  };

  beforeEach(() => {
    usePageStore.setState({
      pages: {
        home: makePage({ id: "home", order: 0, doc: fullPageHomeDoc }),
        idx: makePage({ id: "idx", order: 1, title: "첫 인덱스" }),
      },
      activePageId: null,
      cacheWorkspaceId: WS,
    });
    useSettingsStore.setState({
      tabs: [{ pageId: null, databaseId: "db1" }],
      activeTabIndex: 0,
      lastVisitedPageIdByWorkspaceId: { [WS]: "home" },
    });
  });

  it("전환 진입(forceFirstRoot)이면 직전 풀페이지 DB 탭·기억된 페이지를 무시하고 첫 인덱스로 리셋한다", () => {
    applyWorkspaceLanding(WS, { forceFirstRoot: true });

    const settings = useSettingsStore.getState();
    const tab = settings.tabs[settings.activeTabIndex];
    expect(tab.pageId).toBe("idx");
    expect(tab.databaseId ?? null).toBeNull();
    expect(usePageStore.getState().activePageId).toBe("idx");
  });

  it("전환 진입(forceFirstRoot)이면 다른 워크스페이스의 더 앞선 루트 페이지를 무시한다", () => {
    usePageStore.setState({
      pages: {
        lcMilestone: makePage({
          id: "lcMilestone",
          order: 0,
          workspaceId: "lc-scheduler",
        }),
        catIndex: makePage({ id: "catIndex", order: 1, workspaceId: WS }),
      },
      activePageId: null,
      cacheWorkspaceId: WS,
    });

    applyWorkspaceLanding(WS, { forceFirstRoot: true });

    const settings = useSettingsStore.getState();
    const tab = settings.tabs[settings.activeTabIndex];
    expect(tab.pageId).toBe("catIndex");
    expect(usePageStore.getState().activePageId).toBe("catIndex");
  });

  it("전환 진입(forceFirstRoot)이면 workspaceId 없는 레거시 LC 루트 탭도 무시한다", () => {
    usePageStore.setState({
      pages: {
        legacyLcRoot: makePage({
          id: "legacyLcRoot",
          order: 0,
          doc: {
            type: "doc",
            content: [
              {
                type: "databaseBlock",
                attrs: {
                  layout: "inline",
                  databaseId: "lc-scheduler-db:lc-scheduler-global",
                },
              },
            ],
          },
        }),
        catIndex: makePage({ id: "catIndex", order: 1, workspaceId: WS }),
      },
      activePageId: "legacyLcRoot",
      cacheWorkspaceId: WS,
    });
    useSettingsStore.setState({
      tabs: [{ pageId: "legacyLcRoot", databaseId: null }],
      activeTabIndex: 0,
    });

    applyWorkspaceLanding(WS, { forceFirstRoot: true });

    const settings = useSettingsStore.getState();
    const tab = settings.tabs[settings.activeTabIndex];
    expect(tab.pageId).toBe("catIndex");
    expect(usePageStore.getState().activePageId).toBe("catIndex");
  });

  it("일반 진입(forceFirstRoot 미지정)이면 직전 풀페이지 DB 탭을 유지한다", () => {
    applyWorkspaceLanding(WS);

    const settings = useSettingsStore.getState();
    const tab = settings.tabs[settings.activeTabIndex];
    expect(tab.databaseId).toBe("db1");
  });
});
