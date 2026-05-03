# 노션형 DB 리팩토링 v1.1.3 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노션처럼 DB 행을 페이지로 통합하고, 헤더 "+"로 컬럼 추가·grip 핸들 드래그 재정렬·사이드 피크 모달 등 풀 패리티 UX를 구현한다.

**Architecture:** 행 데이터를 `databaseStore.rows`에서 `pageStore.pages` (with `databaseId`/`dbCells`)로 이전. `DatabaseBundle.rowPageOrder`로 행 페이지 순서 유지. 행 페이지는 트리에서 자동 숨김. 메인 영역에서 `activePage.databaseId` 분기로 `DatabaseRowPage` 렌더, 별도 `peekPageId` 상태로 사이드 피크.

**Tech Stack:** TypeScript, React 19, Zustand persist, TipTap, Vitest, Tailwind, lucide-react, HTML5 native drag.

**참고 문서:** [노션형 DB 리팩토링 설계 (v1.1.3)](../specs/2026-05-03-notion-style-database-design.md)

---

## 파일 구조

| 분류 | 파일 | 역할 |
|------|------|------|
| 타입 | `src/types/page.ts` | `Page`에 `databaseId?`, `dbCells?` 추가 |
| 타입 | `src/types/database.ts` | `DatabaseRow` 제거, `DatabaseRowView` 신설, `DatabaseBundle.rowPageOrder` |
| 스토어 | `src/store/pageStore.ts` | `setPageDbCell` + 트리 필터 |
| 스토어 | `src/store/databaseStore.ts` | v2 schema, 행 페이지 기반 액션, `moveColumn` |
| 스토어 | `src/store/uiStore.ts` (신규) | `peekPageId` 상태 |
| 라이브러리 | `src/lib/databaseQuery.ts` | 시그니처를 `DatabaseRowView` 기반으로 |
| 훅 | `src/components/database/useProcessedRows.ts` | pageStore + dbStore 결합 |
| UI 신규 | `src/components/database/DatabaseColumnMenu.tsx` | 컬럼 헤더 메뉴 |
| UI 신규 | `src/components/database/DatabaseColumnHeader.tsx` | 헤더 셀 (grip + 메뉴 + 인라인 rename) |
| UI 신규 | `src/components/database/DatabaseAddColumnButton.tsx` | 헤더 끝 "+" 셀 |
| UI 신규 | `src/components/database/DatabasePropertyPanel.tsx` | 행 페이지 속성 패널 |
| UI 신규 | `src/components/database/DatabaseRowPage.tsx` | 행 페이지 전체 화면 뷰 |
| UI 신규 | `src/components/database/DatabaseRowPeek.tsx` | 사이드 피크 모달 |
| UI 수정 | `src/components/database/DatabaseBlockView.tsx` | property sidebar 제거, 피크 트리거 추가 |
| UI 수정 | `src/components/database/views/DatabaseTableView.tsx` | 헤더 재구성 + 행 hover 컨트롤 |
| UI 수정 | `src/components/database/views/{Kanban,Gallery,List,Timeline}View.tsx` | 카드 제목 = page.title |
| UI 수정 | `src/components/database/DatabaseCell.tsx` | title 컬럼 제거(=> 패널 상단 큰 input) |
| UI 삭제 | `src/components/database/DatabasePropertySidebar.tsx` | 컬럼 추가는 헤더 "+"가 담당 |
| 라우팅 | `src/App.tsx` | `databaseId` 분기 + 피크 오버레이 |
| 테스트 | `src/__tests__/databaseQuery.test.ts` | `DatabaseRowView` 기반으로 갱신 |
| 테스트 | `src/__tests__/databaseStore.test.ts` (신규) | `addRow`/`updateCell` 페이지 연동, `moveColumn`, v2 migrate |
| 테스트 | `src/__tests__/pageStore.test.ts` (신규) | 행 페이지 트리 필터 |

---

## Task 1: Page 타입 확장 + 행 가시성 필터 (TDD)

**Files:**
- Modify: `src/types/page.ts`
- Modify: `src/store/pageStore.ts`
- Create: `src/__tests__/pageStore.test.ts`

- [ ] **Step 1.1: 테스트 작성**

`src/__tests__/pageStore.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { selectPageTree, selectSortedPages, usePageStore } from "../store/pageStore";

describe("pageStore — DB 행 페이지 가시성", () => {
  beforeEach(() => {
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("databaseId가 있는 페이지는 selectPageTree에서 제외된다", () => {
    const normal = usePageStore.getState().createPage("일반", null, { activate: false });
    const row = usePageStore.getState().createPage("행", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: {
        ...s.pages,
        [row]: { ...s.pages[row]!, databaseId: "db-1", dbCells: {} },
      },
    }));

    const tree = selectPageTree(usePageStore.getState());
    expect(tree.map((p) => p.id)).toEqual([normal]);
  });

  it("selectSortedPages에서도 동일하게 제외된다", () => {
    const normal = usePageStore.getState().createPage("일반", null, { activate: false });
    const row = usePageStore.getState().createPage("행", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: {
        ...s.pages,
        [row]: { ...s.pages[row]!, databaseId: "db-1" },
      },
    }));

    const sorted = selectSortedPages(usePageStore.getState());
    expect(sorted.map((p) => p.id)).toEqual([normal]);
  });

  it("setPageDbCell이 dbCells를 갱신한다", () => {
    const id = usePageStore.getState().createPage("p", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: { ...s.pages, [id]: { ...s.pages[id]!, databaseId: "db-1", dbCells: {} } },
    }));
    usePageStore.getState().setPageDbCell(id, "col-1", "값1");
    expect(usePageStore.getState().pages[id]?.dbCells?.["col-1"]).toBe("값1");
  });
});
```

- [ ] **Step 1.2: 실패 확인**

Run: `npm test -- pageStore`
Expected: 컴파일/실행 실패 (`databaseId` not on Page, `setPageDbCell` not on store).

- [ ] **Step 1.3: Page 타입 확장**

`src/types/page.ts`:
```ts
import type { JSONContent } from "@tiptap/react";
import type { CellValue } from "./database";

export type Page = {
  id: string;
  title: string;
  icon: string | null;
  doc: JSONContent;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** 이 페이지가 DB 행이면 소속 데이터베이스 id */
  databaseId?: string;
  /** title 컬럼을 제외한 셀 값 */
  dbCells?: Record<string, CellValue>;
};

export type PageMap = Record<string, Page>;
```

- [ ] **Step 1.4: pageStore에 setPageDbCell 추가 + 트리 필터**

`src/store/pageStore.ts`에서 actions 타입에 추가:
```ts
setPageDbCell: (pageId: string, columnId: string, value: CellValue) => void;
```

actions 본문 추가 (다른 액션과 동일한 패턴):
```ts
setPageDbCell: (pageId, columnId, value) => {
  set((state) => {
    const page = state.pages[pageId];
    if (!page) return state;
    const nextCells = { ...(page.dbCells ?? {}), [columnId]: value };
    return {
      pages: {
        ...state.pages,
        [pageId]: { ...page, dbCells: nextCells, updatedAt: Date.now() },
      },
    };
  });
},
```

`selectSortedPages`, `selectPageTree`, `filterPageTree` 본문에서 행 페이지 제외:
```ts
export function selectSortedPages(state: PageStore): Page[] {
  return Object.values(state.pages)
    .filter((p) => p.databaseId == null)  // ✅ 행 페이지 숨김
    .sort((a, b) => a.order - b.order);
}

export function selectPageTree(state: PageStore): PageNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of Object.values(state.pages)) {
    if (p.databaseId != null) continue;  // ✅
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  // 이후 동일
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  const build = (parentId: string | null): PageNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({
      ...p,
      children: build(p.id),
    }));
  return build(null);
}

export function filterPageTree(state: PageStore, query: string): PageNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return selectPageTree(state);
  const matched = new Set<string>();
  for (const p of Object.values(state.pages)) {
    if (p.databaseId != null) continue;  // ✅
    if (p.title.toLowerCase().includes(q)) matched.add(p.id);
  }
  // 이후 기존 조상 포함 로직 동일
  const include = new Set(matched);
  for (const id of matched) {
    let cursor: string | null = state.pages[id]?.parentId ?? null;
    while (cursor) {
      include.add(cursor);
      cursor = state.pages[cursor]?.parentId ?? null;
    }
  }
  const prune = (nodes: PageNode[]): PageNode[] =>
    nodes
      .filter((n) => include.has(n.id))
      .map((n) => ({ ...n, children: prune(n.children) }));
  return prune(selectPageTree(state));
}
```

`CellValue` import 추가:
```ts
import type { CellValue } from "../types/database";
```

- [ ] **Step 1.5: 테스트 통과 확인**

Run: `npm test -- pageStore`
Expected: 3 PASS.

- [ ] **Step 1.6: 커밋**

```bash
git add src/types/page.ts src/store/pageStore.ts src/__tests__/pageStore.test.ts
git commit -m "feat(pageStore): databaseId/dbCells 필드 추가 및 트리 필터링"
```

---

## Task 2: database 타입 정리 + DatabaseRowView 도입

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/lib/databaseQuery.ts`
- Modify: `src/__tests__/databaseQuery.test.ts`

- [ ] **Step 2.1: database 타입 변경**

`src/types/database.ts`에서 `DatabaseRow`, `DatabaseBundle` 부분을 다음으로 교체:

```ts
// (기존 DatabaseRow 타입 제거)

/** 뷰 계산용 행: pageStore + databaseStore 합성 결과 */
export type DatabaseRowView = {
  pageId: string;
  databaseId: string;
  title: string;
  cells: Record<string, CellValue>; // titleColId 포함 (=title), 그 외는 page.dbCells
};

export type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  rowPageOrder: string[];
};
```

`DATABASE_STORE_VERSION`을 `2`로 변경:
```ts
export const DATABASE_STORE_VERSION = 2;
```

- [ ] **Step 2.2: databaseQuery.ts를 DatabaseRowView 기반으로**

`src/lib/databaseQuery.ts`에서 `DatabaseRow` import 제거하고 `DatabaseRowView`로 교체. 함수 시그니처도 변경:

```ts
import type {
  CellValue,
  ColumnDef,
  DatabaseRowView,
  FilterOperator,
  FilterRule,
} from "../types/database";

// cellToSearchString — 변화 없음

export function rowMatchesSearch(
  row: DatabaseRowView,
  columns: ColumnDef[],
  query: string,
): boolean { /* 본문 동일 */ }

export function sortRows(
  rows: DatabaseRowView[],
  columnId: string | null,
  dir: "asc" | "desc",
  columns: ColumnDef[],
): DatabaseRowView[] { /* 본문 동일 */ }

function matchesFilter(
  row: DatabaseRowView,
  rule: FilterRule,
  columns: ColumnDef[],
): boolean { /* 동일 */ }

export function applyFilters(
  rows: DatabaseRowView[],
  rules: FilterRule[],
  columns: ColumnDef[],
): DatabaseRowView[] { /* 동일 */ }

export function applyFilterSortSearch(
  rowsOrdered: DatabaseRowView[],
  columns: ColumnDef[],
  searchQuery: string,
  filterRules: FilterRule[],
  sortColumnId: string | null,
  sortDir: "asc" | "desc",
): DatabaseRowView[] { /* 동일 */ }
```

- [ ] **Step 2.3: 기존 테스트 갱신**

`src/__tests__/databaseQuery.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  applyFilterSortSearch,
  rowMatchesSearch,
} from "../lib/databaseQuery";
import type { ColumnDef, DatabaseRowView, FilterRule } from "../types/database";

const columns: ColumnDef[] = [
  { id: "t", name: "이름", type: "title" },
  { id: "n", name: "숫자", type: "number" },
];

const rows: DatabaseRowView[] = [
  { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10 } },
  { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20 } },
];

describe("databaseQuery", () => {
  it("rowMatchesSearch finds text", () => {
    expect(rowMatchesSearch(rows[0]!, columns, "알파")).toBe(true);
    expect(rowMatchesSearch(rows[0]!, columns, "없음")).toBe(false);
  });

  it("applyFilterSortSearch sorts by column", () => {
    const out = applyFilterSortSearch(rows, columns, "", [], "n", "desc");
    expect(out.map((r) => r.pageId)).toEqual(["2", "1"]);
  });

  it("applyFilterSortSearch filters contains", () => {
    const rules: FilterRule[] = [
      { id: "r1", columnId: "t", operator: "contains", value: "베" },
    ];
    const out = applyFilterSortSearch(rows, columns, "", rules, null, "asc");
    expect(out).toHaveLength(1);
    expect(out[0]?.pageId).toBe("2");
  });
});
```

- [ ] **Step 2.4: 테스트 실행 (다른 파일 컴파일 에러는 다음 태스크에서 해결)**

Run: `npx vitest run src/__tests__/databaseQuery.test.ts`
Expected: 3 PASS (다른 파일은 일시적 컴파일 에러여도 본 테스트만 통과하면 OK).

- [ ] **Step 2.5: 커밋**

```bash
git add src/types/database.ts src/lib/databaseQuery.ts src/__tests__/databaseQuery.test.ts
git commit -m "refactor(database): DatabaseRow→DatabaseRowView, Bundle.rowPageOrder, v2 schema"
```

---

## Task 3: databaseStore 재작성 (TDD)

**Files:**
- Create: `src/__tests__/databaseStore.test.ts`
- Modify: `src/store/databaseStore.ts`

- [ ] **Step 3.1: 테스트 작성**

`src/__tests__/databaseStore.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useDatabaseStore } from "../store/databaseStore";
import { usePageStore } from "../store/pageStore";

describe("databaseStore — 페이지 기반 행", () => {
  beforeEach(() => {
    useDatabaseStore.setState({ databases: {}, version: 2 });
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("createDatabase는 시드 행 페이지 1개를 함께 만든다", () => {
    const dbId = useDatabaseStore.getState().createDatabase("DB1");
    const bundle = useDatabaseStore.getState().databases[dbId]!;
    expect(bundle.rowPageOrder).toHaveLength(1);
    const seedPageId = bundle.rowPageOrder[0]!;
    const page = usePageStore.getState().pages[seedPageId]!;
    expect(page.databaseId).toBe(dbId);
    expect(page.title).toBe("항목 1");
  });

  it("addRow는 새 페이지를 만들고 rowPageOrder 끝에 push", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const newPageId = useDatabaseStore.getState().addRow(dbId);
    const bundle = useDatabaseStore.getState().databases[dbId]!;
    expect(bundle.rowPageOrder).toContain(newPageId);
    expect(usePageStore.getState().pages[newPageId]?.databaseId).toBe(dbId);
  });

  it("deleteRow는 페이지와 rowPageOrder 항목을 함께 제거", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const pageId = useDatabaseStore.getState().addRow(dbId);
    useDatabaseStore.getState().deleteRow(dbId, pageId);
    expect(usePageStore.getState().pages[pageId]).toBeUndefined();
    expect(useDatabaseStore.getState().databases[dbId]?.rowPageOrder).not.toContain(pageId);
  });

  it("updateCell title 컬럼은 page.title을 변경", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const bundle = useDatabaseStore.getState().databases[dbId]!;
    const titleCol = bundle.columns.find((c) => c.type === "title")!;
    const pageId = bundle.rowPageOrder[0]!;
    useDatabaseStore.getState().updateCell(dbId, pageId, titleCol.id, "새 제목");
    expect(usePageStore.getState().pages[pageId]?.title).toBe("새 제목");
    expect(usePageStore.getState().pages[pageId]?.dbCells?.[titleCol.id]).toBeUndefined();
  });

  it("updateCell 비-title 컬럼은 dbCells를 변경", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const colId = useDatabaseStore.getState().addColumn(dbId, { name: "메모", type: "text" });
    const pageId = useDatabaseStore.getState().databases[dbId]!.rowPageOrder[0]!;
    useDatabaseStore.getState().updateCell(dbId, pageId, colId, "메모값");
    expect(usePageStore.getState().pages[pageId]?.dbCells?.[colId]).toBe("메모값");
  });

  it("moveColumn은 컬럼 배열 순서를 바꾼다", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const a = useDatabaseStore.getState().addColumn(dbId, { name: "A", type: "text" });
    const b = useDatabaseStore.getState().addColumn(dbId, { name: "B", type: "text" });
    // 초기 순서: [title, A, B]
    useDatabaseStore.getState().moveColumn(dbId, 2, 1); // B를 A 앞으로 → [title, B, A]
    const cols = useDatabaseStore.getState().databases[dbId]!.columns.map((c) => c.id);
    expect(cols).toEqual([cols[0], b, a]);
  });

  it("removeColumn은 title 컬럼을 거부한다", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const titleColId = useDatabaseStore.getState().databases[dbId]!.columns.find((c) => c.type === "title")!.id;
    useDatabaseStore.getState().removeColumn(dbId, titleColId);
    const stillThere = useDatabaseStore.getState().databases[dbId]!.columns.some((c) => c.id === titleColId);
    expect(stillThere).toBe(true);
  });
});
```

- [ ] **Step 3.2: 실패 확인**

Run: `npx vitest run src/__tests__/databaseStore.test.ts`
Expected: FAIL (현재 store는 rows/rowOrder 기반).

- [ ] **Step 3.3: databaseStore 본문 교체**

`src/store/databaseStore.ts`를 다음으로 전면 교체:

```ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabaseMeta,
} from "../types/database";
import { DATABASE_STORE_VERSION } from "../types/database";
import { newId } from "../lib/id";
import { usePageStore } from "./pageStore";

type DbMap = Record<string, DatabaseBundle>;

function now(): number {
  return Date.now();
}

function seedColumns(): ColumnDef[] {
  return [
    { id: newId(), name: "이름", type: "title" },
    { id: newId(), name: "텍스트", type: "text" },
  ];
}

type DatabaseStoreState = {
  version: number;
  databases: DbMap;
};

type DatabaseStoreActions = {
  createDatabase: (title?: string) => string;
  deleteDatabase: (id: string) => void;
  setDatabaseTitle: (id: string, title: string) => void;
  addColumn: (databaseId: string, col: Omit<ColumnDef, "id"> & { id?: string }) => string;
  updateColumn: (
    databaseId: string,
    columnId: string,
    patch: Partial<Pick<ColumnDef, "name" | "type" | "config">>,
  ) => void;
  removeColumn: (databaseId: string, columnId: string) => void;
  moveColumn: (databaseId: string, fromIdx: number, toIdx: number) => void;
  /** 시드/추가 행을 위한 행 페이지 생성 — 새 페이지 id 반환 */
  addRow: (databaseId: string) => string;
  deleteRow: (databaseId: string, pageId: string) => void;
  updateCell: (
    databaseId: string,
    pageId: string,
    columnId: string,
    value: CellValue,
  ) => void;
  setRowOrder: (databaseId: string, orderedPageIds: string[]) => void;
  getBundle: (databaseId: string) => DatabaseBundle | undefined;
  resolveBundle: (databaseId: string) => DatabaseBundle | undefined;
};

export type DatabaseStore = DatabaseStoreState & DatabaseStoreActions;

/** 행 페이지를 직접 생성하고 id를 반환 — pageStore 외부에서 호출됨. */
function createRowPage(databaseId: string, title: string): string {
  const pageId = usePageStore.getState().createPage(title, null, { activate: false });
  usePageStore.setState((s) => {
    const page = s.pages[pageId];
    if (!page) return s;
    return {
      pages: {
        ...s.pages,
        [pageId]: { ...page, databaseId, dbCells: {} },
      },
    };
  });
  return pageId;
}

export const useDatabaseStore = create<DatabaseStore>()(
  persist(
    (set, get) => ({
      version: DATABASE_STORE_VERSION,
      databases: {},

      createDatabase: (title = "새 데이터베이스") => {
        const id = newId();
        const t = now();
        const cols = seedColumns();
        const seedPageId = createRowPage(id, "항목 1");

        const bundle: DatabaseBundle = {
          meta: { id, title, createdAt: t, updatedAt: t },
          columns: cols,
          rowPageOrder: [seedPageId],
        };

        set((state) => ({
          databases: { ...state.databases, [id]: bundle },
        }));
        return id;
      },

      deleteDatabase: (id) => {
        const bundle = get().databases[id];
        if (bundle) {
          for (const pageId of bundle.rowPageOrder) {
            usePageStore.getState().deletePage(pageId);
          }
        }
        set((state) => {
          if (!(id in state.databases)) return state;
          const next = { ...state.databases };
          delete next[id];
          return { databases: next };
        });
      },

      setDatabaseTitle: (id, title) => {
        set((state) => {
          const b = state.databases[id];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [id]: { ...b, meta: { ...b.meta, title, updatedAt: now() } },
            },
          };
        });
      },

      addColumn: (databaseId, colIn) => {
        const colId = colIn.id ?? newId();
        const col: ColumnDef = {
          id: colId,
          name: colIn.name,
          type: colIn.type,
          config: colIn.config,
        };
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                columns: [...bundle.columns, col],
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
        return colId;
      },

      updateColumn: (databaseId, columnId, patch) => {
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const next = bundle.columns.map((c) => {
            if (c.id !== columnId) return c;
            // title 컬럼의 type 변경 차단
            if (c.type === "title" && patch.type && patch.type !== "title") {
              return c;
            }
            return { ...c, ...patch, id: c.id };
          });
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                columns: next,
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
      },

      removeColumn: (databaseId, columnId) => {
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const target = bundle.columns.find((c) => c.id === columnId);
          if (!target || target.type === "title") return state;
          const nextCols = bundle.columns.filter((c) => c.id !== columnId);
          // 모든 행 페이지의 dbCells에서도 해당 키 제거
          const ps = usePageStore.getState();
          for (const pageId of bundle.rowPageOrder) {
            const page = ps.pages[pageId];
            if (!page?.dbCells || !(columnId in page.dbCells)) continue;
            const next = { ...page.dbCells };
            delete next[columnId];
            usePageStore.setState((s) => ({
              pages: {
                ...s.pages,
                [pageId]: { ...s.pages[pageId]!, dbCells: next, updatedAt: Date.now() },
              },
            }));
          }
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                columns: nextCols,
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
      },

      moveColumn: (databaseId, fromIdx, toIdx) => {
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          if (
            fromIdx < 0 ||
            toIdx < 0 ||
            fromIdx >= bundle.columns.length ||
            toIdx >= bundle.columns.length ||
            fromIdx === toIdx
          ) {
            return state;
          }
          const next = [...bundle.columns];
          const [moved] = next.splice(fromIdx, 1);
          if (moved) next.splice(toIdx, 0, moved);
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                columns: next,
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
      },

      addRow: (databaseId) => {
        const bundle = get().databases[databaseId];
        if (!bundle) return "";
        const pageId = createRowPage(
          databaseId,
          `항목 ${bundle.rowPageOrder.length + 1}`,
        );
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                rowPageOrder: [...b.rowPageOrder, pageId],
                meta: { ...b.meta, updatedAt: now() },
              },
            },
          };
        });
        return pageId;
      },

      deleteRow: (databaseId, pageId) => {
        usePageStore.getState().deletePage(pageId);
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                rowPageOrder: bundle.rowPageOrder.filter((id) => id !== pageId),
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
      },

      updateCell: (databaseId, pageId, columnId, value) => {
        const bundle = get().databases[databaseId];
        if (!bundle) return;
        const col = bundle.columns.find((c) => c.id === columnId);
        if (col?.type === "title") {
          const t = typeof value === "string" ? value : "";
          usePageStore.getState().renamePage(pageId, t || "제목 없음");
        } else {
          usePageStore.getState().setPageDbCell(pageId, columnId, value);
        }
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: { ...b, meta: { ...b.meta, updatedAt: now() } },
            },
          };
        });
      },

      setRowOrder: (databaseId, orderedPageIds) => {
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const set_ = new Set(bundle.rowPageOrder);
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                rowPageOrder: orderedPageIds.filter((id) => set_.has(id)),
                meta: { ...bundle.meta, updatedAt: now() },
              },
            },
          };
        });
      },

      getBundle: (databaseId) => get().databases[databaseId],
      resolveBundle: (databaseId) => get().databases[databaseId],
    }),
    {
      name: "quicknote.databaseStore.v1",
      storage: createJSONStorage(() => localStorage),
      version: DATABASE_STORE_VERSION,
      migrate: () => ({ version: DATABASE_STORE_VERSION, databases: {} }),
    },
  ),
);

export function listDatabases(state: DatabaseStore): { id: string; meta: DatabaseMeta }[] {
  return Object.entries(state.databases)
    .map(([id, b]) => ({ id, meta: b.meta }))
    .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
}

export function defaultColumnForType(type: ColumnType, name: string): Omit<ColumnDef, "id"> {
  const base = { name, type };
  if (type === "select" || type === "multiSelect" || type === "status") {
    const opt = (label: string) => ({ id: newId(), label });
    return { ...base, config: { options: [opt("옵션 1"), opt("옵션 2")] } };
  }
  if (type === "date") return { ...base, config: { dateShowEnd: true } };
  return base;
}
```

- [ ] **Step 3.4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/databaseStore.test.ts src/__tests__/pageStore.test.ts src/__tests__/databaseQuery.test.ts`
Expected: 모두 PASS.

- [ ] **Step 3.5: 커밋**

```bash
git add src/store/databaseStore.ts src/__tests__/databaseStore.test.ts
git commit -m "refactor(databaseStore): 행 페이지 기반 + moveColumn + v2 wipe migrate"
```

---

## Task 4: useProcessedRows를 page 기반으로

**Files:**
- Modify: `src/components/database/useProcessedRows.ts`

- [ ] **Step 4.1: 본문 교체**

```ts
import { useMemo } from "react";
import { applyFilterSortSearch } from "../../lib/databaseQuery";
import type { CellValue, DatabasePanelState, DatabaseRowView } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";

export function useProcessedRows(
  databaseId: string,
  panelState: DatabasePanelState,
) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const pages = usePageStore((s) => s.pages);

  const processed = useMemo(() => {
    if (!bundle) return { rows: [] as DatabaseRowView[], columns: [] };
    const titleCol = bundle.columns.find((c) => c.type === "title");
    const ordered: DatabaseRowView[] = [];
    for (const pageId of bundle.rowPageOrder) {
      const page = pages[pageId];
      if (!page) continue;
      const cells: Record<string, CellValue> = { ...(page.dbCells ?? {}) };
      if (titleCol) cells[titleCol.id] = page.title;
      ordered.push({
        pageId,
        databaseId,
        title: page.title,
        cells,
      });
    }
    const rows = applyFilterSortSearch(
      ordered,
      bundle.columns,
      panelState.searchQuery,
      panelState.filterRules,
      panelState.sortColumnId,
      panelState.sortDir,
    );
    return { rows, columns: bundle.columns };
  }, [bundle, pages, databaseId, panelState]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
```

- [ ] **Step 4.2: 커밋**

```bash
git add src/components/database/useProcessedRows.ts
git commit -m "refactor(useProcessedRows): pageStore + databaseStore 합성으로 행 계산"
```

---

## Task 5: peekPageId UI 스토어 추가

**Files:**
- Create: `src/store/uiStore.ts`

- [ ] **Step 5.1: 신규 파일 작성**

```ts
import { create } from "zustand";

type UiStoreState = {
  peekPageId: string | null;
};

type UiStoreActions = {
  openPeek: (pageId: string) => void;
  closePeek: () => void;
};

export const useUiStore = create<UiStoreState & UiStoreActions>((set) => ({
  peekPageId: null,
  openPeek: (pageId) => set({ peekPageId: pageId }),
  closePeek: () => set({ peekPageId: null }),
}));
```

- [ ] **Step 5.2: 커밋**

```bash
git add src/store/uiStore.ts
git commit -m "feat(uiStore): peekPageId 상태로 사이드 피크 모달 토글 관리"
```

---

## Task 6: DatabaseColumnMenu

**Files:**
- Create: `src/components/database/DatabaseColumnMenu.tsx`

- [ ] **Step 6.1: 컴포넌트 작성**

```tsx
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Type } from "lucide-react";
import type { ColumnDef, ColumnType } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { ColumnOptionsEditor } from "./ColumnOptionsEditor";

const TYPE_LABELS: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

type Props = {
  databaseId: string;
  column: ColumnDef;
  onClose: () => void;
  onRequestRename: () => void;
};

export function DatabaseColumnMenu({ databaseId, column, onClose, onRequestRename }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const removeColumn = useDatabaseStore((s) => s.removeColumn);
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const isTitle = column.type === "title";
  const isSelectKind =
    column.type === "select" || column.type === "multiSelect" || column.type === "status";

  return (
    <div
      ref={ref}
      className="absolute z-30 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <button
        type="button"
        onClick={() => { onRequestRename(); onClose(); }}
        className="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Pencil size={12} /> 이름 변경
      </button>

      {!isTitle && (
        <div className="px-2 py-1">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Type size={11} /> 타입
          </div>
          <select
            value={column.type}
            onChange={(e) =>
              updateColumn(databaseId, column.id, { type: e.target.value as ColumnType })
            }
            className="mt-0.5 w-full rounded border border-zinc-200 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {TYPE_LABELS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {isSelectKind && (
        <div className="border-t border-zinc-100 px-1 py-1 dark:border-zinc-800">
          <ColumnOptionsEditor databaseId={databaseId} column={column} />
        </div>
      )}

      {!isTitle && (
        <button
          type="button"
          onClick={() => {
            if (!confirming) { setConfirming(true); return; }
            removeColumn(databaseId, column.id);
            onClose();
          }}
          className={[
            "flex w-full items-center gap-2 rounded px-2 py-1",
            confirming
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "text-zinc-700 hover:bg-red-50 hover:text-red-600 dark:text-zinc-300 dark:hover:bg-red-950/40",
          ].join(" ")}
        >
          <Trash2 size={12} /> {confirming ? "한 번 더 누르면 삭제" : "삭제"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6.2: 커밋**

```bash
git add src/components/database/DatabaseColumnMenu.tsx
git commit -m "feat(database): DatabaseColumnMenu — 이름 변경/타입/옵션/삭제 통합"
```

---

## Task 7: DatabaseColumnHeader (grip + click → menu + inline rename)

**Files:**
- Create: `src/components/database/DatabaseColumnHeader.tsx`

- [ ] **Step 7.1: 컴포넌트 작성**

```tsx
import { useEffect, useRef, useState } from "react";
import { GripVertical, ChevronDown } from "lucide-react";
import type { ColumnDef } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { DatabaseColumnMenu } from "./DatabaseColumnMenu";

type Props = {
  databaseId: string;
  column: ColumnDef;
  index: number;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDrop: () => void;
  highlightDrop?: "left" | "right" | null;
};

export function DatabaseColumnHeader({
  databaseId,
  column,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  highlightDrop,
}: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(column.name); }, [column.name]);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const commitName = () => {
    const t = draft.trim() || "속성";
    if (t !== column.name) updateColumn(databaseId, column.id, { name: t });
    setRenaming(false);
  };

  return (
    <th
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={onDrop}
      className={[
        "group relative whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
        highlightDrop === "left" ? "border-l-2 border-l-blue-500" : "",
        highlightDrop === "right" ? "border-r-2 border-r-blue-500" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", `col:${index}`);
            onDragStart(index);
          }}
          className="cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          title="컬럼 이동"
        >
          <GripVertical size={12} className="text-zinc-400" />
        </span>

        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setDraft(column.name); setRenaming(false); }
            }}
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
          />
        ) : (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            onDoubleClick={() => setRenaming(true)}
            className="flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="열 옵션 (더블클릭하면 이름 변경)"
          >
            <span className="truncate">{column.name}</span>
            <span className="text-[9px] uppercase text-zinc-400">{column.type}</span>
            <ChevronDown size={10} className="ml-auto opacity-0 group-hover:opacity-60" />
          </button>
        )}
      </div>

      {menuOpen && (
        <DatabaseColumnMenu
          databaseId={databaseId}
          column={column}
          onClose={() => setMenuOpen(false)}
          onRequestRename={() => setRenaming(true)}
        />
      )}
    </th>
  );
}
```

- [ ] **Step 7.2: 커밋**

```bash
git add src/components/database/DatabaseColumnHeader.tsx
git commit -m "feat(database): DatabaseColumnHeader — grip 드래그 + 클릭 메뉴 + 인라인 rename"
```

---

## Task 8: DatabaseAddColumnButton

**Files:**
- Create: `src/components/database/DatabaseAddColumnButton.tsx`

- [ ] **Step 8.1: 컴포넌트 작성**

```tsx
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { defaultColumnForType, useDatabaseStore } from "../../store/databaseStore";

const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

export function DatabaseAddColumnButton({ databaseId }: { databaseId: string }) {
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  return (
    <th className="relative w-8 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="속성 추가"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Plus size={14} />
      </button>
      {open && (
        <div
          ref={ref}
          className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">속성 타입</div>
          {COLUMN_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (!bundle) return;
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t.id, `${t.label} ${idx}`));
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </th>
  );
}
```

- [ ] **Step 8.2: 커밋**

```bash
git add src/components/database/DatabaseAddColumnButton.tsx
git commit -m "feat(database): DatabaseAddColumnButton — 헤더 끝 + 버튼으로 컬럼 추가"
```

---

## Task 9: DatabasePropertyPanel

**Files:**
- Create: `src/components/database/DatabasePropertyPanel.tsx`

- [ ] **Step 9.1: 컴포넌트 작성**

```tsx
import { useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { useDatabaseStore, defaultColumnForType } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { DatabaseCell } from "./DatabaseCell";

const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

export function DatabasePropertyPanel({
  databaseId,
  pageId,
}: {
  databaseId: string;
  pageId: string;
}) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const page = usePageStore((s) => s.pages[pageId]);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const [showAdd, setShowAdd] = useState(false);

  if (!bundle || !page) return null;

  return (
    <div className="my-3 space-y-1 border-y border-zinc-200 py-3 text-xs dark:border-zinc-800">
      {bundle.columns
        .filter((c) => c.type !== "title")
        .map((col) => {
          const value = (col.id in (page.dbCells ?? {}))
            ? page.dbCells![col.id]
            : null;
          return (
            <div key={col.id} className="flex items-start gap-2">
              <div className="w-32 shrink-0 truncate pt-0.5 text-zinc-500">
                {col.name}
              </div>
              <div className="min-w-0 flex-1">
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={pageId}
                  column={col}
                  value={value}
                />
              </div>
            </div>
          );
        })}
      <div className="pt-2">
        {showAdd ? (
          <select
            autoFocus
            defaultValue=""
            onBlur={() => setShowAdd(false)}
            onChange={(e) => {
              const t = e.target.value as ColumnType | "";
              if (t) {
                const label = COLUMN_TYPES.find((x) => x.id === t)?.label ?? "속성";
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t, `${label} ${idx}`));
              }
              setShowAdd(false);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">선택…</option>
            {COLUMN_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 속성 추가
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.2: 커밋**

```bash
git add src/components/database/DatabasePropertyPanel.tsx
git commit -m "feat(database): DatabasePropertyPanel — 행 페이지 상단 속성 편집"
```

---

## Task 10: DatabaseRowPage

**Files:**
- Create: `src/components/database/DatabaseRowPage.tsx`

- [ ] **Step 10.1: 컴포넌트 작성**

```tsx
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Editor } from "../editor/Editor";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";

export function DatabaseRowPage({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const renamePage = usePageStore((s) => s.renamePage);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, pageId]);

  if (!page || !databaseId || !bundle) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        행 페이지를 찾을 수 없습니다.
      </div>
    );
  }

  const goBackToDatabase = () => {
    // DB가 풀페이지로 별도 열려 있지 않다면 단순히 이전 탭 페이지로 복귀.
    // 여기서는 이전 활성 페이지 정보를 알 수 없으므로 첫 일반 페이지로.
    const firstNormal = Object.values(usePageStore.getState().pages)
      .filter((p) => p.databaseId == null)
      .sort((a, b) => a.order - b.order)[0];
    setActivePage(firstNormal?.id ?? null);
    setCurrentTabPage(firstNormal?.id ?? null);
  };

  return (
    <div className="mx-auto max-w-[840px] px-12 py-8">
      <button
        type="button"
        onClick={goBackToDatabase}
        className="mb-6 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ArrowLeft size={12} /> {bundle.meta.title}
      </button>

      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => renamePage(pageId, titleDraft.trim() || "제목 없음")}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="제목 없음"
        className="w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400"
      />

      <DatabasePropertyPanel databaseId={databaseId} pageId={pageId} />

      <Editor />
    </div>
  );
}
```

- [ ] **Step 10.2: 커밋**

```bash
git add src/components/database/DatabaseRowPage.tsx
git commit -m "feat(database): DatabaseRowPage — 행 페이지 전체 화면 뷰"
```

---

## Task 11: DatabaseRowPeek (사이드 모달)

**Files:**
- Create: `src/components/database/DatabaseRowPeek.tsx`

- [ ] **Step 11.1: 컴포넌트 작성**

```tsx
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";

export function DatabaseRowPeek() {
  const peekPageId = useUiStore((s) => s.peekPageId);
  const closePeek = useUiStore((s) => s.closePeek);
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const renamePage = usePageStore((s) => s.renamePage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, peekPageId]);

  useEffect(() => {
    if (!peekPageId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekPageId, closePeek]);

  if (!peekPageId || !page || !databaseId || !bundle) return null;

  return (
    <div
      onClick={closePeek}
      className="fixed inset-0 z-40 bg-black/30"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-[480px] flex-col overflow-y-auto border-l border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        <button
          type="button"
          onClick={closePeek}
          className="mb-4 self-end rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={16} />
        </button>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="제목 없음"
          className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
        />
        <DatabasePropertyPanel databaseId={databaseId} pageId={peekPageId} />
        <p className="mt-4 text-[10px] text-zinc-400">
          전체 페이지로 열려면 행의 ↗ 버튼을 사용하세요.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: 커밋**

```bash
git add src/components/database/DatabaseRowPeek.tsx
git commit -m "feat(database): DatabaseRowPeek — 우측 슬라이드 사이드 피크"
```

---

## Task 12: App.tsx 분기 + 피크 마운트

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 12.1: App.tsx 수정**

기존 메인 영역의 `<Editor />`를 분기로 교체:

```tsx
import { useEffect, useLayoutEffect, useRef } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { TabBar } from "./components/layout/TabBar";
import { Editor } from "./components/editor/Editor";
import { DatabaseRowPage } from "./components/database/DatabaseRowPage";
import { DatabaseRowPeek } from "./components/database/DatabaseRowPeek";
import { useSettingsStore } from "./store/settingsStore";
import { usePageStore } from "./store/pageStore";

function App() {
  // ... 기존 hook 들 그대로 ...
  const activePageId = usePageStore((s) => s.activePageId);
  const activePage = usePageStore((s) =>
    activePageId ? s.pages[activePageId] : undefined,
  );

  // ... 기존 effect들 모두 유지 ...

  return (
    <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TabBar />
        <TopBar />
        {activePage?.databaseId ? (
          <div className="flex-1 overflow-y-auto">
            <DatabaseRowPage pageId={activePage.id} />
          </div>
        ) : (
          <Editor />
        )}
      </div>
      <DatabaseRowPeek />
    </div>
  );
}

export default App;
```

- [ ] **Step 12.2: 빌드 확인**

Run: `npm run build`
Expected: 성공 (이 시점엔 TableView가 아직 옛 인터페이스를 쓰고 있으므로 컴파일 에러가 날 수 있음 — 다음 태스크에서 해결).

만약 TableView/Kanban 등이 `r.id` 등 옛 필드를 참조한다면 임시로 `r.pageId`로 바꿔 빌드를 통과시키고 본격 수정은 다음 태스크에서.

- [ ] **Step 12.3: 커밋**

```bash
git add src/App.tsx
git commit -m "feat(app): activePage.databaseId 분기 + DatabaseRowPeek 마운트"
```

---

## Task 13: DatabaseTableView 재작성

**Files:**
- Modify: `src/components/database/views/DatabaseTableView.tsx`

- [ ] **Step 13.1: 본문 교체**

```tsx
import { useState } from "react";
import { Plus, GripVertical, ArrowUpRight, PanelRight } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

export function DatabaseTableView({ databaseId }: Props) {
  const panelState = { searchQuery: "", filterRules: [], sortColumnId: null, sortDir: "asc" as const,
    kanbanGroupColumnId: null, galleryCoverColumnId: null, timelineDateColumnId: null };
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const moveColumn = useDatabaseStore((s) => s.moveColumn);
  const setRowOrder = useDatabaseStore((s) => s.setRowOrder);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [colDragFrom, setColDragFrom] = useState<number | null>(null);
  const [colDragOver, setColDragOver] = useState<number | null>(null);
  const [rowDragFrom, setRowDragFrom] = useState<number | null>(null);
  const [rowDragOver, setRowDragOver] = useState<number | null>(null);

  if (!bundle) return null;

  const titleCol = columns.find((c) => c.type === "title");

  const onColDrop = () => {
    if (colDragFrom != null && colDragOver != null && colDragFrom !== colDragOver) {
      moveColumn(databaseId, colDragFrom, colDragOver);
    }
    setColDragFrom(null);
    setColDragOver(null);
  };

  const onRowDrop = () => {
    if (rowDragFrom != null && rowDragOver != null && rowDragFrom !== rowDragOver) {
      const order = [...bundle.rowPageOrder];
      const [m] = order.splice(rowDragFrom, 1);
      if (m) order.splice(rowDragOver, 0, m);
      setRowOrder(databaseId, order);
    }
    setRowDragFrom(null);
    setRowDragOver(null);
  };

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <div className="inline-block min-w-full align-middle">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            {/* 행 핸들 컬럼 자리 */}
            <th className="w-8 border-b border-zinc-200 dark:border-zinc-700" />
            {columns.map((col, idx) => (
              <DatabaseColumnHeader
                key={col.id}
                databaseId={databaseId}
                column={col}
                index={idx}
                onDragStart={(i) => setColDragFrom(i)}
                onDragOver={(i) => setColDragOver(i)}
                onDrop={onColDrop}
                highlightDrop={
                  colDragFrom != null && colDragOver === idx && colDragFrom !== idx
                    ? colDragFrom < idx ? "right" : "left"
                    : null
                }
              />
            ))}
            <DatabaseAddColumnButton databaseId={databaseId} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => {
            const isDropTarget = rowDragFrom != null && rowDragOver === rIdx && rowDragFrom !== rIdx;
            return (
              <tr
                key={row.pageId}
                onDragOver={(e) => { e.preventDefault(); setRowDragOver(rIdx); }}
                onDrop={onRowDrop}
                className={[
                  "group border-b border-zinc-100 dark:border-zinc-800",
                  isDropTarget ? "border-t-2 border-t-blue-500" : "",
                ].join(" ")}
              >
                <td className="w-8 px-1 align-middle">
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", `row:${rIdx}`);
                        setRowDragFrom(rIdx);
                      }}
                      className="cursor-grab active:cursor-grabbing"
                      title="행 이동"
                    >
                      <GripVertical size={12} className="text-zinc-400" />
                    </span>
                    <button
                      type="button"
                      onClick={() => openFull(row.pageId)}
                      title="페이지로 열기"
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <ArrowUpRight size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openPeek(row.pageId)}
                      title="사이드 피크 열기"
                      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <PanelRight size={11} />
                    </button>
                  </div>
                </td>
                {columns.map((col) => (
                  <td key={col.id} className="align-top px-2 py-1">
                    {col.type === "title" ? (
                      <DatabaseCell
                        databaseId={databaseId}
                        rowId={row.pageId}
                        column={col}
                        value={row.title}
                      />
                    ) : (
                      <DatabaseCell
                        databaseId={databaseId}
                        rowId={row.pageId}
                        column={col}
                        value={row.cells[col.id]}
                      />
                    )}
                  </td>
                ))}
                <td className="w-8 px-1 align-middle text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)")) {
                        deleteRow(databaseId, row.pageId);
                      }
                    }}
                    title="행 삭제"
                    className="text-[10px] text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-500"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus size={14} /> 새 항목
      </button>
    </div>
  );
}
```

> 참고: panelState는 props로 그대로 받는다. 위 임시 객체는 잘못된 패턴이므로 원래대로:

```tsx
export function DatabaseTableView({ databaseId, panelState }: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  // 나머지 동일
}
```

(임시 객체 라인 삭제. 위 본문에서 panelState 임시 변수 부분을 props 사용으로 교체.)

- [ ] **Step 13.2: DatabaseCell title 처리 확인**

`DatabaseCell.tsx`의 title 케이스는 그대로 두되, 변경된 호출 흐름은:
- title 컬럼이 `value`로 `row.title`(=page.title)을 받고, `updateCell`이 호출되면 `databaseStore.updateCell` → `pageStore.renamePage`로 라우팅됨. 추가 변경 불필요.

- [ ] **Step 13.3: 빌드 확인**

Run: `npm run build`
Expected: TableView 컴파일 성공. 다른 뷰는 다음 태스크에서 처리.

- [ ] **Step 13.4: 커밋**

```bash
git add src/components/database/views/DatabaseTableView.tsx
git commit -m "feat(database): DatabaseTableView 재작성 — grip 드래그/+버튼/행 open·peek 트리거"
```

---

## Task 14: DatabaseBlockView 정리 (PropertySidebar 제거)

**Files:**
- Modify: `src/components/database/DatabaseBlockView.tsx`
- Delete: `src/components/database/DatabasePropertySidebar.tsx`

- [ ] **Step 14.1: DatabaseBlockView에서 propsOpen·DatabasePropertySidebar 제거**

기존 import:
```tsx
import { DatabasePropertySidebar } from "./DatabasePropertySidebar";
```
삭제.

기존 코드:
```tsx
const [propsOpen, setPropsOpen] = useState(false);
```
및 settings 버튼, 아래 `propsOpen && <DatabasePropertySidebar ... />` 블록 모두 삭제.

`Settings2` import도 미사용이면 제거.

- [ ] **Step 14.2: 사용하지 않는 파일 삭제**

```bash
rm src/components/database/DatabasePropertySidebar.tsx
```

- [ ] **Step 14.3: 빌드 확인**

Run: `npm run build`
Expected: 성공. (다른 뷰 미수정 상태일 수 있음 — 다음 태스크에서 처리)

- [ ] **Step 14.4: 커밋**

```bash
git add -u src/components/database/DatabaseBlockView.tsx src/components/database/DatabasePropertySidebar.tsx
git commit -m "refactor(database): PropertySidebar 제거 — 헤더 + 컬럼 메뉴로 통합"
```

---

## Task 15: 나머지 뷰 4종을 DatabaseRowView 기반으로

**Files:**
- Modify: `src/components/database/views/DatabaseKanbanView.tsx`
- Modify: `src/components/database/views/DatabaseGalleryView.tsx`
- Modify: `src/components/database/views/DatabaseListView.tsx`
- Modify: `src/components/database/views/DatabaseTimelineView.tsx`

각 뷰는 `useProcessedRows`가 반환하는 `rows`가 이제 `DatabaseRowView[]` (필드: `pageId`, `title`, `cells`).

- [ ] **Step 15.1: 각 뷰 파일에서 다음 패턴 일괄 치환**

| 옛 식 | 새 식 |
|-------|-------|
| `row.id` | `row.pageId` |
| `row.cells[titleCol.id]` 또는 비슷한 title 셀 접근 | `row.title` |
| `updateCell(databaseId, row.id, ...)` | `updateCell(databaseId, row.pageId, ...)` |
| `addRow`/`deleteRow` 호출 인자 | `pageId` 사용 |

각 뷰의 카드/행 클릭 동작에서 페이지 열기·피크가 필요하면 동일 패턴(`useUiStore.openPeek`, `setActivePage + setCurrentTabPage`) 적용. 단순화를 위해 본 PR에서는 각 카드를 클릭해도 별도 동작이 없으면 그대로 두고, 우측 상단에 작은 "↗ 열기" 버튼만 추가:

```tsx
import { ArrowUpRight, PanelRight } from "lucide-react";
import { useUiStore } from "../../../store/uiStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { usePageStore } from "../../../store/pageStore";

const setActivePage = usePageStore((s) => s.setActivePage);
const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
const openPeek = useUiStore((s) => s.openPeek);

// 카드 헤더 영역에:
<div className="flex items-center justify-between">
  <span className="truncate text-xs font-medium">{row.title}</span>
  <div className="flex gap-0.5">
    <button onClick={() => { setActivePage(row.pageId); setCurrentTabPage(row.pageId); }}><ArrowUpRight size={11}/></button>
    <button onClick={() => openPeek(row.pageId)}><PanelRight size={11}/></button>
  </div>
</div>
```

- [ ] **Step 15.2: 빌드 + 타입체크 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 15.3: 커밋**

```bash
git add src/components/database/views/DatabaseKanbanView.tsx src/components/database/views/DatabaseGalleryView.tsx src/components/database/views/DatabaseListView.tsx src/components/database/views/DatabaseTimelineView.tsx
git commit -m "refactor(database views): DatabaseRowView 필드 기반으로 갱신 + open/peek 액션"
```

---

## Task 16: 슬래시 메뉴 createDatabase 흐름 점검

**Files:**
- Verify: `src/lib/tiptapExtensions/slashItems.ts`

- [ ] **Step 16.1: 코드 점검**

`grep -n "createDatabase\|databaseBlock" src/lib/tiptapExtensions/slashItems.ts`
- `createDatabase()`가 dbId만 반환하고 시드 행 페이지가 자동 생성되는지 확인.
- `insertContent({ type: "databaseBlock", attrs: { databaseId: id, view: ... } })` 호출이 그대로 동작하는지 확인.

DB 생성 후 별도로 `pageStore.createPage`를 호출하던 옛 코드가 있다면 제거 (시드 페이지는 이제 store가 책임).

- [ ] **Step 16.2: 변경 시 커밋**

```bash
git add -u src/lib/tiptapExtensions/slashItems.ts
git commit -m "chore(slash): 옛 시드 행 호출 제거 — createDatabase 내부에서 처리"
```

(변경 불필요 시 본 태스크는 통과만 표시.)

---

## Task 17: 통합 테스트 + 수동 QA

**Files:**
- Test: `npm test`
- Manual QA on `npm run dev`

- [ ] **Step 17.1: 단위 테스트 일괄 실행**

Run: `npm test`
Expected: pageStore / databaseStore / databaseQuery 모두 PASS.

- [ ] **Step 17.2: 빌드**

Run: `npm run build`
Expected: 0 error, 0 warning (구현 코드 기준).

- [ ] **Step 17.3: 개발 서버 + 수동 QA**

Run: `npm run dev`

체크리스트 (브라우저에서):
1. [ ] 슬래시 메뉴 `/db` → 표 선택 → DB 블록 + 시드 행 1개 표시.
2. [ ] 행 1줄의 ↗ 클릭 → 페이지 전체 화면으로 전환, 백버튼 작동.
3. [ ] ⤢ 클릭 → 우측 사이드 피크 모달 표시, ESC/바깥 클릭 닫힘.
4. [ ] 표 헤더 우측 "+" 클릭 → 타입 선택 → 새 컬럼 추가됨.
5. [ ] 컬럼 헤더 hover → grip 표시 → 드래그로 다른 위치에 드롭 → 순서 변경.
6. [ ] 행 hover → grip 드래그로 행 순서 변경.
7. [ ] 컬럼 헤더 클릭 → 메뉴 → 이름 변경/타입 변경/삭제 동작.
8. [ ] title 컬럼은 메뉴에 "삭제"가 비활성/제거되어 있음.
9. [ ] 사이드바 페이지 트리에 행 페이지가 노출되지 않음.
10. [ ] 행 페이지 상단에서 제목·속성 편집 → 표 뷰로 돌아오면 즉시 반영.
11. [ ] 칸반/갤러리/리스트/타임라인 뷰 전환 후에도 카드 제목이 page.title을 따라감.
12. [ ] 같은 DB 블록을 다른 페이지에 연결 → 동일 행 집합 표시 (소스 공유).

- [ ] **Step 17.4: 마무리 커밋 (필요 시)**

수동 QA 중 발견한 사소한 수정이 있으면:
```bash
git add -u
git commit -m "fix(database): 수동 QA 보정"
```

---

## Self-Review 결과

**Spec coverage:** 설계의 6개 결정사항(피크/풀페이지, page.title 직결, 트리 숨김, 헤더 +, grip, wipe migrate)을 Task 1~13에서 모두 다룸. Test plan 12개 시나리오는 Task 17 체크리스트로 매핑.

**Placeholder scan:** "TBD"/"TODO" 없음. 모든 코드 블록은 실제 컴파일 가능한 형태로 작성.

**Type consistency:**
- Page 신규 필드: `databaseId?`, `dbCells?` — Tasks 1, 3, 4, 9에서 동일하게 사용.
- DatabaseRowView 필드: `pageId`, `databaseId`, `title`, `cells` — Tasks 2, 4, 13, 15 모두 동일.
- store 액션: `addRow`/`deleteRow`/`updateCell`/`moveColumn`/`setRowOrder` — Task 3 정의, Tasks 13~15에서 동일 시그니처로 호출.

**작은 보완:** Task 13의 "참고:" 박스에 `panelState` 임시 객체 사용을 props 사용으로 교체하는 안내가 명시됨 — 작성자가 prop을 빠뜨리지 않도록.
