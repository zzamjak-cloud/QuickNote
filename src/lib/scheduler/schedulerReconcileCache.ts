import { zustandStorage } from "../storage/index";

const KEY_PREFIX = "quicknote.scheduler.cache.reconcile.v1.";

type UpdatedEntity = {
  updatedAt?: string | null;
};

function cacheKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`;
}

export function resolveNextSchedulerReconcileWatermark(
  current: string | null,
  pages: UpdatedEntity[],
  databases: UpdatedEntity[],
): string | null {
  let next = current;
  for (const item of [...pages, ...databases]) {
    if (!item.updatedAt) continue;
    if (!next || item.updatedAt > next) next = item.updatedAt;
  }
  return next;
}

export async function readSchedulerReconcileWatermark(workspaceId: string): Promise<string | null> {
  const raw = await zustandStorage.getItem(cacheKey(workspaceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { updatedAfter?: unknown };
    return typeof parsed.updatedAfter === "string" ? parsed.updatedAfter : null;
  } catch {
    return null;
  }
}

export async function writeSchedulerReconcileWatermark(
  workspaceId: string,
  updatedAfter: string,
): Promise<void> {
  await zustandStorage.setItem(cacheKey(workspaceId), JSON.stringify({ updatedAfter }));
}
