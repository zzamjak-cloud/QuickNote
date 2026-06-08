import type { Page } from "../../types/page";
import {
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
} from "../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";

export const LC_SCHEDULER_ROOT_DATABASE_IDS = [
  LC_MILESTONE_DATABASE_ID,
  LC_FEATURE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
] as const;

export const LC_SCHEDULER_ROOT_PAGE_TITLES_BY_DATABASE_ID: Record<string, string> = {
  [LC_MILESTONE_DATABASE_ID]: "마일스톤 DB",
  [LC_FEATURE_DATABASE_ID]: "피처 DB",
  [LC_SCHEDULER_DATABASE_ID]: "작업 DB",
};

type DatabaseBlockInfo = {
  databaseId: string;
  layout: string | null;
};

export type LCSchedulerRootPageStatus = {
  presentDatabaseIds: string[];
  missingDatabaseIds: string[];
  complete: boolean;
};

export type LCSchedulerRootPageRepairGate = {
  shouldAttempt: (
    workspaceId: string | null | undefined,
    pages: Record<string, Page>,
  ) => boolean;
};

function getFirstDatabaseBlockInfo(page: Page): DatabaseBlockInfo | null {
  const first = (page.doc as { content?: unknown[] } | undefined)?.content?.[0] as
    | { type?: unknown; attrs?: Record<string, unknown> }
    | undefined;
  if (first?.type !== "databaseBlock") return null;
  const databaseId = first.attrs?.databaseId;
  if (typeof databaseId !== "string") return null;
  const layout = first.attrs?.layout;
  return {
    databaseId,
    layout: typeof layout === "string" ? layout : null,
  };
}

function isDeletedPage(page: Page): boolean {
  return Boolean((page as { deletedAt?: unknown }).deletedAt);
}

function isLCSchedulerRootPageCandidate(page: Page): boolean {
  return (
    page.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
    page.parentId == null &&
    page.databaseId == null &&
    page.fullPageDatabaseId == null &&
    !isDeletedPage(page)
  );
}

export function getLCSchedulerRootPageStatus(
  pages: Record<string, Page>,
): LCSchedulerRootPageStatus {
  const requiredDatabaseIds = new Set<string>(LC_SCHEDULER_ROOT_DATABASE_IDS);
  const titleToDatabaseId = new Map(
    Object.entries(LC_SCHEDULER_ROOT_PAGE_TITLES_BY_DATABASE_ID).map(
      ([databaseId, title]) => [title, databaseId] as const,
    ),
  );
  const presentDatabaseIds = new Set<string>();

  for (const page of Object.values(pages)) {
    if (!isLCSchedulerRootPageCandidate(page)) continue;

    const firstDatabaseBlock = getFirstDatabaseBlockInfo(page);
    if (firstDatabaseBlock?.layout === "fullPage") continue;
    if (
      firstDatabaseBlock &&
      requiredDatabaseIds.has(firstDatabaseBlock.databaseId)
    ) {
      presentDatabaseIds.add(firstDatabaseBlock.databaseId);
    }

    const titleDatabaseId = titleToDatabaseId.get(page.title.trim());
    if (titleDatabaseId) {
      presentDatabaseIds.add(titleDatabaseId);
    }
  }

  const missingDatabaseIds = LC_SCHEDULER_ROOT_DATABASE_IDS.filter(
    (databaseId) => !presentDatabaseIds.has(databaseId),
  );

  return {
    presentDatabaseIds: LC_SCHEDULER_ROOT_DATABASE_IDS.filter((databaseId) =>
      presentDatabaseIds.has(databaseId),
    ),
    missingDatabaseIds,
    complete: missingDatabaseIds.length === 0,
  };
}

export function lcSchedulerRootPagesNeedRepair(
  workspaceId: string | null | undefined,
  pages: Record<string, Page>,
): boolean {
  if (workspaceId !== LC_SCHEDULER_WORKSPACE_ID) return false;
  return !getLCSchedulerRootPageStatus(pages).complete;
}

export function createLCSchedulerRootPageRepairGate(): LCSchedulerRootPageRepairGate {
  const attemptedWorkspaceIds = new Set<string>();

  return {
    shouldAttempt: (workspaceId, pages) => {
      if (workspaceId !== LC_SCHEDULER_WORKSPACE_ID) return false;
      const needsRepair = lcSchedulerRootPagesNeedRepair(workspaceId, pages);
      if (!needsRepair) {
        attemptedWorkspaceIds.delete(workspaceId);
        return false;
      }
      if (attemptedWorkspaceIds.has(workspaceId)) return false;
      attemptedWorkspaceIds.add(workspaceId);
      return true;
    },
  };
}
