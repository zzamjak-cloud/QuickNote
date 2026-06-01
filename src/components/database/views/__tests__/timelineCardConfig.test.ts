import { describe, expect, it } from "vitest";
import { useDatabaseStore } from "../../../../store/databaseStore";
import type { ColumnDef } from "../../../../types/database";
import { buildTimelineCardConfigPatch } from "../timelineCardConfig";

describe("buildTimelineCardConfigPatch", () => {
  it("최신 store 값을 기준으로 날짜 카드 설정을 병합해 빠른 연속 변경에서도 기존 옵션을 보존한다", () => {
    const staleColumn: ColumnDef = {
      id: "date-1",
      name: "기간",
      type: "date",
    };

    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 1 },
          columns: [
            {
              ...staleColumn,
              config: {
                timelineCard: {
                  enabled: true,
                  titleMode: "pageTitle",
                },
              },
            },
          ],
          rowPageOrder: [],
        },
      },
    });

    const config = buildTimelineCardConfigPatch("db-1", staleColumn, {
      titleMode: "custom",
      title: "검수 일정",
    });

    expect(config?.timelineCard).toEqual({
      enabled: true,
      titleMode: "custom",
      title: "검수 일정",
    });
  });
});
