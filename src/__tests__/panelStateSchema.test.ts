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
      schedulerMemberOrderUpdatedAt: 1234,
    });
    const out = parseDatabasePanelStateJson(raw);
    expect(out.schedulerMemberOrder).toEqual(["member-3", "member-1", "member-2"]);
    expect(out.schedulerMemberOrderUpdatedAt).toBe(1234);
  });

  it("이중 인코딩(AWSJSON 구독 페이로드)된 panelState 도 복구한다", () => {
    // 서버/AppSync 가 이미 stringify 된 panelState 를 다시 stringify 해 내려보내는 경우.
    const inner = JSON.stringify({
      schedulerMemberOrder: ["m2", "m1"],
      schedulerMemberOrderUpdatedAt: 1780312873975,
      searchQuery: "hi",
    });
    const doubleEncoded = JSON.stringify(inner);
    const out = parseDatabasePanelStateJson(doubleEncoded);
    expect(out.schedulerMemberOrder).toEqual(["m2", "m1"]);
    expect(out.schedulerMemberOrderUpdatedAt).toBe(1780312873975);
    expect(out.searchQuery).toBe("hi");
  });

  it("그룹화 설정(groupByColumnId)을 동기화 round-trip 에서 보존한다", () => {
    // zod 스키마 누락 시 동기화에서 잘리는 회귀 방지 — 설정값/해제(null) 모두 검증.
    const raw = JSON.stringify({ groupByColumnId: "c-person" });
    expect(parseDatabasePanelStateJson(raw).groupByColumnId).toBe("c-person");

    const cleared = JSON.stringify({ groupByColumnId: null });
    expect(parseDatabasePanelStateJson(cleared).groupByColumnId).toBeNull();

    // 미설정 시 기본값(null)
    expect(parseDatabasePanelStateJson("{}").groupByColumnId).toBeNull();
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
      pageTreeEnabled: true,
    });
    const out = parseDatabasePanelStateJson(raw);
    expect(out.hiddenViewKinds).toEqual(["list"]);
    expect(out.viewConfigs.list?.visibleColumnIds).toEqual(["title"]);
    expect(out.viewConfigs.table?.visibleColumnIds).toEqual(["title", "status"]);
    expect(out.itemLimit).toBe(50);
    expect(out.pageTreeEnabled).toBe(true);
  });
});
