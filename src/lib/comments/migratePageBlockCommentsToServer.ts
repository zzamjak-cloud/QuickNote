/**
 * 레거시 page.blockComments 를 독립 Comment 테이블로 1회 마이그레이션.
 * 완료 여부는 localStorage 플래그로 관리한다.
 */
import { newId } from "../id";
import { enqueueAsync } from "../sync/runtime";
import { usePageStore } from "../../store/pageStore";

const MIGRATION_FLAG_KEY = "quicknote.bc.migratedToServer.v1";

function wasMigrated(workspaceId: string): boolean {
  try {
    const raw = localStorage.getItem(MIGRATION_FLAG_KEY);
    if (!raw) return false;
    const done = JSON.parse(raw) as string[];
    return Array.isArray(done) && done.includes(workspaceId);
  } catch {
    return false;
  }
}

function markMigrated(workspaceId: string): void {
  try {
    const raw = localStorage.getItem(MIGRATION_FLAG_KEY);
    const done: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!done.includes(workspaceId)) done.push(workspaceId);
    localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify(done));
  } catch {
    /* noop */
  }
}

export function migratePageBlockCommentsToServerOnce(
  workspaceId: string,
): void {
  if (wasMigrated(workspaceId)) return;

  const pages = usePageStore.getState().pages;
  const now = new Date().toISOString();

  for (const page of Object.values(pages)) {
    const bc = page.blockComments;
    if (!bc?.messages.length) continue;
    for (const msg of bc.messages) {
      enqueueAsync("upsertComment", {
        id: msg.id ?? newId(),
        workspaceId: msg.workspaceId ?? workspaceId,
        pageId: msg.pageId ?? page.id,
        blockId: msg.blockId,
        authorMemberId: msg.authorMemberId,
        bodyText: msg.bodyText,
        mentionMemberIds: JSON.stringify(msg.mentionMemberIds ?? []),
        parentId: msg.parentId ?? null,
        createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : now,
        updatedAt: now,
      });
    }
  }

  markMigrated(workspaceId);
}
