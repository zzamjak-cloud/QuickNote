import { describe, expect, it, beforeEach, vi } from "vitest";
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
    // 초기 순서: [title, ..., A, B]. createDatabase는 title + 텍스트 시드 컬럼을 만듦.
    // addColumn 후: [title, 텍스트, A, B] → moveColumn(3, 2): B를 A 앞으로 → [title, 텍스트, B, A]
    const cols0 = useDatabaseStore.getState().databases[dbId]!.columns;
    const aIdx = cols0.findIndex((c) => c.id === a);
    const bIdx = cols0.findIndex((c) => c.id === b);
    useDatabaseStore.getState().moveColumn(dbId, bIdx, aIdx);
    const cols = useDatabaseStore.getState().databases[dbId]!.columns.map((c) => c.id);
    // B가 A보다 앞에 와야 한다
    expect(cols.indexOf(b)).toBeLessThan(cols.indexOf(a));
  });

  it("removeColumn은 title 컬럼을 거부한다", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    const titleColId = useDatabaseStore.getState().databases[dbId]!.columns.find((c) => c.type === "title")!.id;
    useDatabaseStore.getState().removeColumn(dbId, titleColId);
    const stillThere = useDatabaseStore.getState().databases[dbId]!.columns.some((c) => c.id === titleColId);
    expect(stillThere).toBe(true);
  });

  it("removeColumn은 행이 여러 개여도 pageStore.setState를 1회만 호출한다", () => {
    const dbId = useDatabaseStore.getState().createDatabase();
    useDatabaseStore.getState().addRow(dbId);
    useDatabaseStore.getState().addRow(dbId);
    const bundle = useDatabaseStore.getState().databases[dbId]!;
    const textCol = bundle.columns.find((c) => c.type === "text" && c.name === "텍스트")!;
    const spy = vi.spyOn(usePageStore, "setState");
    const before = spy.mock.calls.length;
    useDatabaseStore.getState().removeColumn(dbId, textCol.id);
    const callsForThisOp = spy.mock.calls.length - before;
    expect(callsForThisOp).toBe(1);
    spy.mockRestore();
  });
});
