import { beforeEach, describe, expect, it } from "vitest";
import type { GqlDatabaseHistoryEntry } from "../../sync/graphql/operations";
import {
  buildDatabaseHistorySnapshotMap,
  getPreviousDatabaseHistorySnapshot,
} from "../databaseHistoryPatch";
import { buildDatabasePreviewChanges } from "../historyPreviewDiff";

const baseSnapshot = {
  id: "db-1",
  workspaceId: "workspace-1",
  title: "초기 DB",
  columns: JSON.stringify([{ id: "title", name: "이름", type: "title" }]),
  presets: null,
  panelState: JSON.stringify({ viewConfigs: {} }),
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function historyEntry(
  historyId: string,
  patch: unknown,
  anchor?: unknown,
): GqlDatabaseHistoryEntry {
  return {
    databaseId: "db-1",
    historyId,
    workspaceId: "workspace-1",
    ownerId: "owner-1",
    kind: "database.update",
    patch,
    anchor,
    createdAt: historyId.slice(0, 24),
  };
}

describe("databaseHistoryPatch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("AppSync AWSJSON 문자열 patch와 anchor로 DB 버전 프리뷰를 구성한다", () => {
    const entries: GqlDatabaseHistoryEntry[] = [
      historyEntry(
        "2026-06-01T00:00:00.000Z#1",
        JSON.stringify([{ op: "set", path: ["title"], value: "초기 DB" }]),
        JSON.stringify(baseSnapshot),
      ),
      historyEntry(
        "2026-06-02T00:00:00.000Z#2",
        JSON.stringify([{ op: "set", path: ["title"], value: "수정 DB" }]),
      ),
    ];

    const snapshotMap = buildDatabaseHistorySnapshotMap(entries, "db-1", "workspace-1");
    const selectedAfter = snapshotMap.get("2026-06-02T00:00:00.000Z#2") ?? null;
    const selectedBefore = getPreviousDatabaseHistorySnapshot(
      entries,
      "db-1",
      "workspace-1",
      "2026-06-02T00:00:00.000Z#2",
    );

    expect(selectedBefore?.title).toBe("초기 DB");
    expect(selectedAfter?.title).toBe("수정 DB");
    expect(buildDatabasePreviewChanges(selectedBefore, selectedAfter)).toEqual([
      {
        id: "title",
        label: "DB 이름",
        before: "초기 DB",
        after: "수정 DB",
        kind: "changed",
      },
    ]);
  });
});
