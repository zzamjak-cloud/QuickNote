import { describe, expect, it } from "vitest";
import type { Page } from "../../../types/page";
import {
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
} from "../../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";
import {
  getLCSchedulerRootPageStatus,
  lcSchedulerRootPagesNeedRepair,
} from "../lcSchedulerWorkspaceRepair";

const makePage = (overrides: Partial<Page> & Pick<Page, "id" | "title">): Page => ({
  id: overrides.id,
  workspaceId: LC_SCHEDULER_WORKSPACE_ID,
  title: overrides.title,
  icon: null,
  doc: { type: "doc", content: [] },
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("lcSchedulerWorkspaceRepair", () => {
  it("DB row cache만 있고 LC 루트 DB 페이지가 없으면 repair 대상으로 판정한다", () => {
    const pages: Record<string, Page> = {
      "task-row": makePage({
        id: "task-row",
        title: "작업 row",
        databaseId: LC_SCHEDULER_DATABASE_ID,
      }),
    };

    const status = getLCSchedulerRootPageStatus(pages);

    expect(status.missingDatabaseIds).toEqual([
      LC_MILESTONE_DATABASE_ID,
      LC_FEATURE_DATABASE_ID,
      LC_SCHEDULER_DATABASE_ID,
    ]);
    expect(lcSchedulerRootPagesNeedRepair(LC_SCHEDULER_WORKSPACE_ID, pages)).toBe(true);
  });

  it("meta-only 루트 페이지 제목만 있어도 사이드바 표시 가능한 상태로 본다", () => {
    const pages: Record<string, Page> = {
      milestone: makePage({ id: "milestone", title: "마일스톤 DB" }),
      feature: makePage({ id: "feature", title: "피처 DB" }),
      task: makePage({ id: "task", title: "작업 DB" }),
    };

    const status = getLCSchedulerRootPageStatus(pages);

    expect(status.missingDatabaseIds).toEqual([]);
    expect(lcSchedulerRootPagesNeedRepair(LC_SCHEDULER_WORKSPACE_ID, pages)).toBe(false);
  });

  it("사용자가 제목을 바꿔도 inline databaseBlock이면 루트 페이지로 인식한다", () => {
    const pages: Record<string, Page> = {
      milestone: makePage({ id: "milestone", title: "마일스톤 DB" }),
      feature: makePage({
        id: "feature",
        title: "Renamed feature database",
        doc: {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: { databaseId: LC_FEATURE_DATABASE_ID, layout: "inline" },
            },
          ],
        },
      }),
      task: makePage({ id: "task", title: "작업 DB" }),
    };

    expect(getLCSchedulerRootPageStatus(pages).missingDatabaseIds).toEqual([]);
    expect(lcSchedulerRootPagesNeedRepair(LC_SCHEDULER_WORKSPACE_ID, pages)).toBe(false);
  });

  it("LC 스케줄러 워크스페이스가 아니면 repair 대상으로 보지 않는다", () => {
    expect(lcSchedulerRootPagesNeedRepair("normal-workspace", {})).toBe(false);
  });
});
