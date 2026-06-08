import { describe, expect, it } from "vitest";
import {
  buildGeneratedTemplatePage,
  buildTemplateAutomationPageId,
  buildTemplateAutomationScheduleExpression,
  buildTemplateAutomationScheduleName,
  collectTemplateAutomationTargets,
} from "./common";

describe("template automation common", () => {
  it("collects normalized automation targets from templates AWSJSON", () => {
    const targets = collectTemplateAutomationTargets({
      templates: JSON.stringify([
        {
          id: "template-1",
          title: "QA",
          cells: { status: "todo" },
          pageId: "template-page-1",
          automation: {
            id: "automation-1",
            enabled: true,
            weekdays: [1, "3", 9],
            time: "09:30",
            timezone: "Asia/Seoul",
            maxAttempts: 99,
          },
        },
      ]),
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]?.automation).toMatchObject({
      id: "automation-1",
      weekdays: [1, 3],
      maxAttempts: 5,
    });
  });

  it("builds EventBridge Scheduler cron expression", () => {
    expect(
      buildTemplateAutomationScheduleExpression({
        weekdays: [1, 3, 5],
        time: "09:30",
      }),
    ).toBe("cron(30 9 ? * MON,WED,FRI *)");
  });

  it("builds stable schedule and page ids", () => {
    const scheduleName = buildTemplateAutomationScheduleName({
      databaseId: "db-1",
      templateId: "template-1",
      automationId: "automation-1",
    });
    expect(scheduleName).toMatch(/^qn-ta-[a-f0-9]{48}$/);
    expect(
      buildTemplateAutomationPageId({
        automationId: "automation-1",
        scheduledTime: "2026-06-08T00:30:00Z",
      }),
    ).toBe(
      buildTemplateAutomationPageId({
        automationId: "automation-1",
        scheduledTime: "2026-06-08T00:30:00Z",
      }),
    );
  });

  it("builds generated page payload from template page", () => {
    const page = buildGeneratedTemplatePage({
      database: {
        id: "db-1",
        workspaceId: "ws-1",
        createdByMemberId: "member-1",
        columns: JSON.stringify([
          { id: "title", name: "Name", type: "title" },
          { id: "date", name: "Date", type: "date" },
        ]),
        panelState: JSON.stringify({ timelineDateColumnId: "date" }),
      },
      template: {
        id: "template-1",
        title: "QA",
        cells: {},
        pageId: "template-page-1",
        automation: {
          id: "automation-1",
          enabled: true,
          weekdays: [1],
          time: "09:30",
          timezone: "Asia/Seoul",
          titlePrefix: "QA",
        },
      },
      templatePage: {
        title: "QA Template",
        doc: "{\"type\":\"doc\"}",
        dbCells: { status: "todo", _qn_isTemplate: "1" },
      },
      pageId: "page-1",
      scheduledTime: "2026-06-08T00:30:00.000Z",
      nowIso: "2026-06-08T00:31:00.000Z",
    });

    expect(page).toMatchObject({
      id: "page-1",
      workspaceId: "ws-1",
      databaseId: "db-1",
      title: "QA 26/06/08",
      doc: "{\"type\":\"doc\"}",
      createdByMemberId: "member-1",
      dbCells: {
        status: "todo",
        date: { start: "2026-06-08" },
      },
    });
    expect(page.dbCells).not.toHaveProperty("_qn_isTemplate");
  });
});
