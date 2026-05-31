import { describe, expect, it } from "vitest";
import type { CellValue } from "../../../types/database";
import type { Page } from "../../../types/page";
import { LC_FEATURE_COLUMN_IDS } from "../featureDatabase";
import { LC_MILESTONE_COLUMN_IDS } from "../milestoneDatabase";
import {
  getScopedMilestoneIds,
  matchesSchedulerScope,
  schedulerPageLinkIncludes,
} from "../databaseScope";

function page(id: string, dbCells: Record<string, CellValue>): Page {
  return {
    id,
    title: id,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    dbCells,
  };
}

describe("scheduler database scope", () => {
  it("피처의 프로젝트 셀이 비어 있어도 연결된 마일스톤 프로젝트로 스코프 매칭한다", () => {
    const milestone = page("milestone-a", {
      [LC_MILESTONE_COLUMN_IDS.project]: "project-a",
    });
    const feature = page("feature-a", {
      [LC_FEATURE_COLUMN_IDS.milestone]: ["milestone-a"],
    });

    expect(
      matchesSchedulerScope(feature, "feature", "proj:project-a", {
        [milestone.id]: milestone,
        [feature.id]: feature,
      }),
    ).toBe(true);
    expect(
      matchesSchedulerScope(feature, "feature", "proj:project-b", {
        [milestone.id]: milestone,
        [feature.id]: feature,
      }),
    ).toBe(false);
  });

  it("피처가 마일스톤에 연결되어 있으면 복사된 프로젝트 셀보다 마일스톤 프로젝트를 우선한다", () => {
    const milestone = page("milestone-b", {
      [LC_MILESTONE_COLUMN_IDS.project]: "project-b",
    });
    const feature = page("feature-a", {
      [LC_FEATURE_COLUMN_IDS.project]: "project-a",
      [LC_FEATURE_COLUMN_IDS.milestone]: ["milestone-b"],
    });
    const pages = { [milestone.id]: milestone, [feature.id]: feature };

    expect(matchesSchedulerScope(feature, "feature", "proj:project-a", pages)).toBe(false);
    expect(matchesSchedulerScope(feature, "feature", "proj:project-b", pages)).toBe(true);
  });

  it("마일스톤 드롭다운 후보를 현재 스코프에 속한 항목으로 제한한다", () => {
    const milestoneA = page("milestone-a", {
      [LC_MILESTONE_COLUMN_IDS.project]: "project-a",
    });
    const milestoneB = page("milestone-b", {
      [LC_MILESTONE_COLUMN_IDS.project]: "project-b",
    });

    expect(
      getScopedMilestoneIds(
        [milestoneA.id, milestoneB.id],
        { [milestoneA.id]: milestoneA, [milestoneB.id]: milestoneB },
        "proj:project-a",
      ),
    ).toEqual(new Set(["milestone-a"]));
  });

  it("pageLink 셀 문자열과 배열을 모두 마일스톤 필터로 판정한다", () => {
    expect(schedulerPageLinkIncludes(["a", "b"], new Set(["b"]))).toBe(true);
    expect(schedulerPageLinkIncludes("a", new Set(["a"]))).toBe(true);
    expect(schedulerPageLinkIncludes(["a"], new Set(["b"]))).toBe(false);
  });
});
