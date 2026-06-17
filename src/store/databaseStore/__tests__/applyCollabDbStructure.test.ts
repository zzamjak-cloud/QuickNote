import { describe, it, expect, beforeEach } from "vitest";
import { useDatabaseStore } from "../../databaseStore";

describe("applyCollabDbStructure", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {
        d1: {
          meta: { id: "d1", title: "원래제목", createdAt: 1, updatedAt: 1, workspaceId: "ws" },
          columns: [{ id: "c1", name: "제목", type: "title" }],
          rowPageOrder: ["p1"],
        },
      },
    } as never);
  });

  it("구조 반영 + meta.title 보존", () => {
    useDatabaseStore.getState().applyCollabDbStructure("d1", {
      columns: [
        { id: "c1", name: "제목", type: "title" },
        { id: "c2", name: "상태", type: "select" },
      ],
      presets: [],
      panelState: { sort: { columnId: "c1", dir: "asc" } },
      rowPageOrder: ["p1", "p2"],
    });
    const db = useDatabaseStore.getState().databases["d1"];
    expect(db.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(db.meta.title).toBe("원래제목");
    expect(db.rowPageOrder).toEqual(["p1", "p2"]);
    // panelState 는 emptyPanelState 기본값으로 정규화되므로(searchQuery 누락 .trim() 크래시 방지)
    // 입력 필드 보존만 부분 일치로 검증한다.
    expect(db.panelState).toMatchObject({ sort: { columnId: "c1", dir: "asc" } });
  });

  it("부분 시드(멤버·순서 모두 빈) 구조는 기존 행 순서를 비우지 못한다", () => {
    useDatabaseStore.getState().applyCollabDbStructure("d1", {
      columns: [{ id: "c1", name: "제목", type: "title" }],
      presets: [],
      panelState: {},
      rowPageOrder: [],
      rowMembers: [],
    });
    expect(useDatabaseStore.getState().databases["d1"].rowPageOrder).toEqual(["p1"]);
  });
});
