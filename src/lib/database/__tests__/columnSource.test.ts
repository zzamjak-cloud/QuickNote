import { describe, expect, it } from "vitest";
import type { DatabaseBundle } from "../../../types/database";
import type { Page } from "../../../types/page";
import { applySearchFilters } from "../columnSource";

const makePage = (id: string, databaseId: string, dbCells: Record<string, unknown> = {}): Page => ({
  id,
  workspaceId: "ws",
  title: id,
  icon: null,
  doc: { type: "doc", content: [] },
  parentId: null,
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  databaseId,
  dbCells,
});

describe("applySearchFilters", () => {
  it("sourceFromDb 자동화 컬럼의 조직/마일스톤 값을 단계 필터에서 사용한다", () => {
    const databases: Record<string, DatabaseBundle> = {
      milestoneDb: {
        meta: { id: "milestoneDb", title: "마일스톤", createdAt: 1, updatedAt: 1 },
        columns: [
          { id: "title", name: "마일스톤", type: "title" },
          { id: "organization", name: "조직", type: "select", config: { linkedScope: "organization" } },
        ],
        rowPageOrder: ["milestoneA"],
      },
      featureDb: {
        meta: { id: "featureDb", title: "피처", createdAt: 1, updatedAt: 1 },
        columns: [
          { id: "title", name: "피처", type: "title" },
          { id: "milestone", name: "마일스톤", type: "pageLink", config: { pageLinkScopeDatabaseId: "milestoneDb" } },
          {
            id: "organization",
            name: "조직",
            type: "select",
            config: {
              sourceFromDb: {
                databaseId: "milestoneDb",
                columnId: "organization",
                automation: true,
                viaPageLinkColumnId: "milestone",
              },
            },
          },
        ],
        rowPageOrder: ["featureA"],
      },
      taskDb: {
        meta: { id: "taskDb", title: "작업", createdAt: 1, updatedAt: 1 },
        columns: [
          { id: "title", name: "작업", type: "title" },
          { id: "feature", name: "피처", type: "pageLink", config: { pageLinkScopeDatabaseId: "featureDb" } },
          {
            id: "milestone",
            name: "마일스톤",
            type: "pageLink",
            config: {
              pageLinkScopeDatabaseId: "milestoneDb",
              sourceFromDb: {
                databaseId: "featureDb",
                columnId: "milestone",
                automation: true,
                viaPageLinkColumnId: "feature",
              },
            },
          },
          {
            id: "organization",
            name: "조직",
            type: "select",
            config: {
              sourceFromDb: {
                databaseId: "featureDb",
                columnId: "organization",
                automation: true,
                viaPageLinkColumnId: "feature",
              },
            },
          },
        ],
        rowPageOrder: ["taskA"],
      },
    };
    const pages: Record<string, Page> = {
      milestoneA: makePage("milestoneA", "milestoneDb", { organization: "orgA" }),
      featureA: makePage("featureA", "featureDb", { milestone: ["milestoneA"] }),
      taskA: makePage("taskA", "taskDb", { feature: ["featureA"] }),
    };

    expect(
      applySearchFilters(
        [pages.taskA!],
        [
          { id: "org", kind: "organization", value: "orgA" },
          { id: "milestone", kind: "milestone", value: "milestoneA" },
        ],
        databases,
        pages,
      ),
    ).toEqual([pages.taskA]);
  });
});
