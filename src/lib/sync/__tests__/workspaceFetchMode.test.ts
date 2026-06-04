import { describe, expect, it } from "vitest";
import { resolveWorkspaceRemoteFetchMode } from "../workspaceFetchMode";

describe("resolveWorkspaceRemoteFetchMode", () => {
  it("캐시와 워터마크가 있으면 워크스페이스 전환도 증분으로 처리한다", () => {
    expect(
      resolveWorkspaceRemoteFetchMode({
        cacheAvailable: true,
        switchCleared: false,
        switchReason: "restored-snapshot",
        watermark: "2026-06-04T00:00:00.000Z",
      }),
    ).toEqual({
      kind: "delta",
      updatedAfter: "2026-06-04T00:00:00.000Z",
      reason: "cache-watermark",
    });
  });

  it("캐시가 없으면 전체 스냅샷을 받는다", () => {
    expect(
      resolveWorkspaceRemoteFetchMode({
        cacheAvailable: false,
        switchCleared: false,
        switchReason: "initial-bootstrap",
        watermark: "2026-06-04T00:00:00.000Z",
      }),
    ).toEqual({ kind: "full", reason: "no-cache" });
  });

  it("워터마크가 없으면 캐시가 있어도 전체 스냅샷으로 기준선을 만든다", () => {
    expect(
      resolveWorkspaceRemoteFetchMode({
        cacheAvailable: true,
        switchCleared: false,
        switchReason: "initial-bootstrap",
      }),
    ).toEqual({ kind: "full", reason: "no-watermark" });
  });

  it("캐시가 클리어되거나 전환이 보류된 경로는 전체 스냅샷을 받는다", () => {
    expect(
      resolveWorkspaceRemoteFetchMode({
        cacheAvailable: true,
        switchCleared: true,
        switchReason: "initial-cache-mismatch",
        watermark: "2026-06-04T00:00:00.000Z",
      }),
    ).toEqual({ kind: "full", reason: "cache-cleared" });

    expect(
      resolveWorkspaceRemoteFetchMode({
        cacheAvailable: true,
        switchCleared: false,
        switchReason: "deferred-switch",
        watermark: "2026-06-04T00:00:00.000Z",
      }),
    ).toEqual({ kind: "full", reason: "deferred-switch" });
  });
});
