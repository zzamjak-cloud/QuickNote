import { describe, expect, it } from "vitest";
import { resolveNextSchedulerReconcileWatermark } from "../schedulerReconcileCache";

describe("scheduler reconcile cache", () => {
  it("pages와 databases 중 가장 최신 updatedAt을 다음 watermark로 사용한다", () => {
    expect(resolveNextSchedulerReconcileWatermark("2026-06-01T00:00:00.000Z", [
      { updatedAt: "2026-06-02T00:00:00.000Z" },
    ], [
      { updatedAt: "2026-06-03T00:00:00.000Z" },
    ])).toBe("2026-06-03T00:00:00.000Z");
  });

  it("변경분이 없으면 기존 watermark를 유지한다", () => {
    expect(resolveNextSchedulerReconcileWatermark("2026-06-01T00:00:00.000Z", [], [])).toBe("2026-06-01T00:00:00.000Z");
  });
});
