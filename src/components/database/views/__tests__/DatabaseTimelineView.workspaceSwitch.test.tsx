import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPanelState, type ColumnDef, type DatabasePanelState } from "../../../../types/database";
import { useDatabaseStore } from "../../../../store/databaseStore";
import { useMemberStore } from "../../../../store/memberStore";
import { usePageStore } from "../../../../store/pageStore";
import { DatabaseTimelineView } from "../DatabaseTimelineView";

// 워크스페이스 전환 직후 타임라인이 "숨김/0폭" 상태에서 mount 되었다가 뒤늦게 레이아웃되는
// 상황을 재현하기 위한 ResizeObserver 모킹. observe 된 element 와 콜백을 보관했다가
// 테스트에서 수동으로 발화시킨다.
let resizeCallback: ResizeObserverCallback | null = null;
let observedElement: Element | null = null;

class ControllableResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallback = cb;
  }
  observe(el: Element) {
    observedElement = el;
  }
  unobserve() {}
  disconnect() {}
}

const titleColumn: ColumnDef = { id: "title", name: "이름", type: "title" };
const dateColumn: ColumnDef = { id: "period", name: "기간", type: "date" };

function seedTimelineDatabase() {
  useDatabaseStore.setState({
    databases: {
      "db-1": {
        meta: { id: "db-1", title: "작업 DB", createdAt: 1, updatedAt: 1 },
        columns: [titleColumn, dateColumn],
        rowPageOrder: ["task-1"],
      },
    },
    cacheWorkspaceId: "ws-1",
  });
  usePageStore.setState({
    pages: {
      "task-1": {
        id: "task-1",
        workspaceId: "ws-1",
        title: "작업 카드",
        icon: null,
        doc: { type: "doc", content: [] },
        parentId: null,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        databaseId: "db-1",
        dbCells: { period: { start: "2026-06-10", end: "2026-06-14" } },
      },
    },
    activePageId: null,
  });
}

function defineClientWidth(el: Element, value: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => value });
}

function defineScrollWidth(el: Element, value: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => value });
}

describe("DatabaseTimelineView 워크스페이스 전환 후 연간 자동 스크롤", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 연중(6/15)으로 고정 → 오늘이 화면 시작(연초)보다 충분히 오른쪽이라 scrollLeft > 0 이어야 한다.
    vi.setSystemTime(new Date(2026, 5, 15));
    vi.stubGlobal("ResizeObserver", ControllableResizeObserver);
    resizeCallback = null;
    observedElement = null;
    localStorage.clear();
    localStorage.setItem("quicknote.timeline.granularity", "year");
    localStorage.setItem("quicknote.timeline.year", "2025");
    localStorage.setItem("quicknote.timeline.zoom", "100");
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    usePageStore.setState({ pages: {}, activePageId: null });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("0폭 상태에서 mount 되면 오늘 스크롤을 잠그지 않고, 레이아웃이 잡힌 뒤 오늘로 스크롤한다", () => {
    seedTimelineDatabase();
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
    };

    const { container } = render(
      <DatabaseTimelineView databaseId="db-1" panelState={panelState} setPanelState={vi.fn()} />,
    );

    const scroller = container.querySelector(".qn-database-subtle-scrollbar") as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.className).not.toContain("invisible");

    // scrollLeft 쓰기를 기록 (jsdom 은 레이아웃이 없어 기본값이 0).
    let scrollLeftValue = 0;
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      get: () => scrollLeftValue,
      set: (v: number) => {
        scrollLeftValue = v;
      },
    });

    // 초기 mount 시점은 컨테이너가 0폭(숨김) → 자동 스크롤이 "잠기면" 안 된다.
    // (clientWidth 는 jsdom 기본 0)
    expect(scrollLeftValue).toBe(0);
    const cardBeforeLayout = container.querySelector("[data-db-timeline-card-id='task-1::period']");
    expect(cardBeforeLayout).not.toBeNull();

    // 이제 레이아웃이 잡힌 상태를 시뮬레이션: 스크롤 컨테이너와 트랙이 폭을 가진다.
    defineClientWidth(scroller, 800);
    defineScrollWidth(scroller, 36660);
    if (observedElement) defineClientWidth(observedElement, 36500);

    // ResizeObserver 발화 → setTrackPxWidth → useLayoutEffect 재실행 → 오늘로 스크롤.
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });

    // 0(연초)에 고정되지 않고 오늘(연중) 근처로 스크롤되어야 한다.
    expect(scrollLeftValue).toBeGreaterThan(0);
    expect(container.querySelector("[data-db-timeline-card-id='task-1::period']")).toBe(cardBeforeLayout);
  });
});
