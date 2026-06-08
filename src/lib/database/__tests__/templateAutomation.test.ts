import { describe, expect, it } from "vitest";
import type { ColumnDef, DatabasePanelState, DatabaseTemplate } from "../../../types/database";
import {
  buildTemplateAutomationGeneratedRow,
  buildTemplateAutomationScheduleExpression,
  normalizeTemplateAutomationConfig,
  resolveTemplateAutomationDateColumnId,
} from "../templateAutomation";

const columns: ColumnDef[] = [
  { id: "title", name: "Name", type: "title" },
  { id: "status", name: "Status", type: "status" },
  { id: "fallback-date", name: "Fallback", type: "date" },
  { id: "due", name: "Due", type: "date" },
];

const panelState: DatabasePanelState = {
  searchQuery: "",
  filterRules: [],
  sortColumnId: null,
  sortDir: "asc",
  sortRules: [],
  kanbanGroupColumnId: null,
  groupByColumnId: null,
  galleryCoverColumnId: null,
  timelineDateColumnId: "due",
  viewConfigs: {},
  hiddenViewKinds: [],
};

const template: DatabaseTemplate = {
  id: "template-1",
  title: "QA Check",
  cells: {
    status: "todo",
    _qn_isTemplate: "1",
  },
  pageId: "template-page-1",
};

describe("templateAutomation", () => {
  it("normalizes weekly automation config and clamps retry attempts", () => {
    expect(
      normalizeTemplateAutomationConfig(
        {
          id: "automation-1",
          enabled: true,
          weekdays: [1, 1, 7, "2"],
          time: "09:30",
          timezone: "Asia/Seoul",
          titlePrefix: "QA",
          maxAttempts: 20,
          endDate: "2026-06-30",
        },
        "fallback",
      ),
    ).toEqual({
      id: "automation-1",
      enabled: true,
      weekdays: [1, 2],
      time: "09:30",
      timezone: "Asia/Seoul",
      titlePrefix: "QA",
      maxAttempts: 5,
      endDate: "2026-06-30",
      updatedAt: undefined,
    });
  });

  it("builds EventBridge Scheduler cron expression by selected weekdays", () => {
    expect(
      buildTemplateAutomationScheduleExpression({
        id: "automation-1",
        enabled: true,
        weekdays: [1, 3, 5],
        time: "09:30",
        timezone: "Asia/Seoul",
      }),
    ).toBe("cron(30 9 ? * MON,WED,FRI *)");
  });

  it("uses timeline date column before the first date column", () => {
    expect(resolveTemplateAutomationDateColumnId(columns, panelState)).toBe("due");
    expect(resolveTemplateAutomationDateColumnId(columns, { ...panelState, timelineDateColumnId: null })).toBe(
      "fallback-date",
    );
  });

  it("builds generated row title and cells without the template marker", () => {
    const row = buildTemplateAutomationGeneratedRow({
      template,
      columns,
      panelState,
      scheduledAt: "2026-06-08T00:30:00.000Z",
      automation: {
        id: "automation-1",
        enabled: true,
        weekdays: [1],
        time: "09:30",
        timezone: "Asia/Seoul",
        titlePrefix: "QA",
      },
    });

    expect(row.title).toBe("QA 26/06/08");
    expect(row.cells).toEqual({
      status: "todo",
      due: { start: "2026-06-08" },
    });
  });
});
