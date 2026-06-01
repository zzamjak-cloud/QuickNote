import { describe, it, expect } from "vitest";
import { parseDatabasePanelStateJson } from "../lib/schemas/panelStateSchema";
import { emptyPanelState } from "../types/database";

describe("parseDatabasePanelStateJson", () => {
  it("유효한 필드만 병합한다", () => {
    const raw = JSON.stringify({
      searchQuery: "hello",
      filterRules: [
        {
          id: "f1",
          columnId: "c1",
          operator: "contains" as const,
          value: "x",
        },
      ],
      schedulerFeatureMilestoneIds: ["milestone-1"],
    });
    const out = parseDatabasePanelStateJson(raw);
    expect(out.searchQuery).toBe("hello");
    expect(out.filterRules).toHaveLength(1);
    expect(out.schedulerFeatureMilestoneIds).toEqual(["milestone-1"]);
    expect(out.sortRules).toEqual(emptyPanelState().sortRules);
  });

  it("구성원 탭 순서(schedulerMemberOrder)를 동기화 round-trip 에서 보존한다", () => {
    const raw = JSON.stringify({
      schedulerMemberOrder: ["member-3", "member-1", "member-2"],
    });
    const out = parseDatabasePanelStateJson(raw);
    expect(out.schedulerMemberOrder).toEqual(["member-3", "member-1", "member-2"]);
  });

  it("손상 JSON이면 기본 패널 상태", () => {
    expect(parseDatabasePanelStateJson("")).toEqual(emptyPanelState());
    expect(parseDatabasePanelStateJson("{")).toEqual(emptyPanelState());
  });

  it("__proto__ 등 알 수 없는 키는 무시하고 기본값 유지", () => {
    const polluted = '{"searchQuery":"ok","__proto__":{"polluted":true}}';
    const out = parseDatabasePanelStateJson(polluted);
    expect(out.searchQuery).toBe("ok");
    expect(
      Object.prototype.hasOwnProperty.call(out as object, "__proto__"),
    ).toBe(false);
  });

  it("검증 실패 형태면 폴백", () => {
    const bad = JSON.stringify({
      filterRules: "not-array",
    });
    expect(parseDatabasePanelStateJson(bad)).toEqual(emptyPanelState());
  });

  it("리스트 모드 숨김과 뷰별 속성 표시 설정을 유지한다", () => {
    const raw = JSON.stringify({
      hiddenViewKinds: ["list"],
      viewConfigs: {
        list: { visibleColumnIds: ["title"] },
        table: { visibleColumnIds: ["title", "status"] },
      },
      itemLimit: 50,
    });
    const out = parseDatabasePanelStateJson(raw);
    expect(out.hiddenViewKinds).toEqual(["list"]);
    expect(out.viewConfigs.list?.visibleColumnIds).toEqual(["title"]);
    expect(out.viewConfigs.table?.visibleColumnIds).toEqual(["title", "status"]);
    expect(out.itemLimit).toBe(50);
  });
});
