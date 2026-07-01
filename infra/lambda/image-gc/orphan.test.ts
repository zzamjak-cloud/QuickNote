import { describe, expect, it } from "vitest";
import { planOrphans } from "./orphan";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-02T00:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("planOrphans (2단계 고아 판정)", () => {
  it("처음 고아로 보이면 삭제하지 않고 마킹만 한다", () => {
    const plan = planOrphans([{ id: "a", key: "k/a" }], new Set(), NOW);
    expect(plan.toMark.map((r) => r.id)).toEqual(["a"]);
    expect(plan.toDelete).toEqual([]);
  });

  it("확정 기간(7일) 미달이면 마킹 유지만 하고 삭제하지 않는다", () => {
    const plan = planOrphans(
      [{ id: "a", key: "k/a", orphanSince: iso(3 * DAY) }],
      new Set(),
      NOW,
    );
    expect(plan.toDelete).toEqual([]);
    expect(plan.toMark).toEqual([]);
  });

  it("확정 기간을 넘겨 연속 고아면 삭제 대상으로 확정한다", () => {
    const plan = planOrphans(
      [{ id: "a", key: "k/a", orphanSince: iso(8 * DAY) }],
      new Set(),
      NOW,
    );
    expect(plan.toDelete.map((r) => r.id)).toEqual(["a"]);
  });

  it("참조가 다시 보이면(협업 doc 지연 복구 등) 마킹을 해제한다", () => {
    const plan = planOrphans(
      [{ id: "a", key: "k/a", orphanSince: iso(10 * DAY) }],
      new Set(["a"]),
      NOW,
    );
    expect(plan.toReclaim.map((r) => r.id)).toEqual(["a"]);
    expect(plan.toDelete).toEqual([]);
  });

  it("orphanSince 가 손상된 값이면 삭제하지 않고 재마킹한다(안전 우선)", () => {
    const plan = planOrphans(
      [{ id: "a", key: "k/a", orphanSince: "garbage" }],
      new Set(),
      NOW,
    );
    expect(plan.toDelete).toEqual([]);
    expect(plan.toMark.map((r) => r.id)).toEqual(["a"]);
  });

  it("도달 가능하고 마킹도 없는 자산은 아무 대상에도 없다", () => {
    const plan = planOrphans([{ id: "a", key: "k/a" }], new Set(["a"]), NOW);
    expect(plan.toMark).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toReclaim).toEqual([]);
  });
});
