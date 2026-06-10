import { beforeEach, describe, expect, it } from "vitest";
import type { GqlPageHistoryEntry } from "../../sync/graphql/operations";
import {
  buildPageHistorySnapshotMap,
  getPreviousPageHistorySnapshot,
} from "../pageHistoryPatch";
import { buildPagePreviewChanges } from "../historyPreviewDiff";

const baseSnapshot = {
  id: "page-1",
  workspaceId: "workspace-1",
  title: "초기 제목",
  doc: JSON.stringify({ type: "doc", content: [] }),
  databaseId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function historyEntry(
  historyId: string,
  patch: unknown,
  anchor?: unknown,
): GqlPageHistoryEntry {
  return {
    pageId: "page-1",
    historyId,
    workspaceId: "workspace-1",
    kind: "page.update",
    patch,
    anchor,
    createdAt: historyId.slice(0, 24),
  } as GqlPageHistoryEntry;
}

const ENTRIES: GqlPageHistoryEntry[] = [
  historyEntry(
    "2026-06-01T00:00:00.000Z#1",
    JSON.stringify([{ op: "set", path: ["title"], value: "초기 제목" }]),
    JSON.stringify(baseSnapshot),
  ),
  historyEntry(
    "2026-06-02T00:00:00.000Z#2",
    JSON.stringify([{ op: "set", path: ["title"], value: "수정 제목" }]),
  ),
];

const emptyCtx = {
  getDatabaseTitle: () => null,
  getPageTitle: () => null,
  getColumnName: () => null,
  getOptionLabel: () => null,
};

describe("pageHistoryPatch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("anchor + patch 로 페이지 버전 스냅샷을 재구성한다", () => {
    const snapshotMap = buildPageHistorySnapshotMap(ENTRIES, "page-1", "workspace-1");
    const after = snapshotMap.get("2026-06-02T00:00:00.000Z#2") ?? null;
    const before = getPreviousPageHistorySnapshot(
      ENTRIES,
      "page-1",
      "workspace-1",
      "2026-06-02T00:00:00.000Z#2",
    );
    expect(before?.title).toBe("초기 제목");
    expect(after?.title).toBe("수정 제목");
    const changes = buildPagePreviewChanges(before, after, emptyCtx);
    expect(changes.some((c) => c.before === "초기 제목" && c.after === "수정 제목")).toBe(true);
  });

  it("두 번째 빌드는 localStorage 캐시를 재사용해도 동일한 결과를 낸다", () => {
    // 첫 빌드 → 캐시 기록
    buildPageHistorySnapshotMap(ENTRIES, "page-1", "workspace-1");
    expect(localStorage.getItem("quicknote.pageHistoryPreview.v1")).not.toBeNull();
    // 두 번째 빌드 → 캐시 히트 경로
    const second = buildPageHistorySnapshotMap(ENTRIES, "page-1", "workspace-1");
    expect(second.get("2026-06-01T00:00:00.000Z#1")?.title).toBe("초기 제목");
    expect(second.get("2026-06-02T00:00:00.000Z#2")?.title).toBe("수정 제목");
  });

  it("캐시 히트로 재사용된 이전 스냅샷이 이후 패치로 오염되지 않는다", () => {
    // v1, v2 캐시 채우기
    buildPageHistorySnapshotMap(ENTRIES, "page-1", "workspace-1");
    // v3 추가(제목 재변경) — v1·v2 는 캐시 히트, v3 만 새로 계산
    const withV3 = [
      ...ENTRIES,
      historyEntry(
        "2026-06-03T00:00:00.000Z#3",
        JSON.stringify([{ op: "set", path: ["title"], value: "최종 제목" }]),
      ),
    ];
    const map = buildPageHistorySnapshotMap(withV3, "page-1", "workspace-1");
    // 이전 버전 스냅샷이 v3 패치로 변형되지 않아야 한다(공유 참조 오염 회귀 방지).
    expect(map.get("2026-06-01T00:00:00.000Z#1")?.title).toBe("초기 제목");
    expect(map.get("2026-06-02T00:00:00.000Z#2")?.title).toBe("수정 제목");
    expect(map.get("2026-06-03T00:00:00.000Z#3")?.title).toBe("최종 제목");
  });
});
