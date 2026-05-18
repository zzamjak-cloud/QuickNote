import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import type { BlockCommentMsg } from "../../store/blockCommentStore";
import { zustandStorage } from "../storage/index";
import { getSyncEngine } from "./runtime";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import { isLCSchedulerDatabaseId } from "../scheduler/database";

type WorkspaceSnapshot = {
  pages: ReturnType<typeof usePageStore.getState>["pages"];
  databases: ReturnType<typeof useDatabaseStore.getState>["databases"];
  activePageId: string | null;
  tabs: ReturnType<typeof useSettingsStore.getState>["tabs"];
  activeTabIndex: number;
  comments: BlockCommentMsg[];
};

const workspaceSnapshotById = new Map<string, WorkspaceSnapshot>();
const WORKSPACE_SNAPSHOT_KEY_PREFIX = "quicknote.workspace.snapshot.v2:";

function workspaceSnapshotKey(workspaceId: string): string {
  return `${WORKSPACE_SNAPSHOT_KEY_PREFIX}${workspaceId}`;
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function persistWorkspaceSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot | null): void {
  const key = workspaceSnapshotKey(workspaceId);
  void (async () => {
    try {
      if (!snapshot) {
        await zustandStorage.removeItem(key);
        return;
      }
      await zustandStorage.setItem(key, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("[sync] workspace snapshot persist failed", { workspaceId, error });
    }
  })();
}

function captureWorkspaceSnapshot(workspaceId: string): void {
  if (!workspaceId || workspaceId === LC_SCHEDULER_WORKSPACE_ID) return;
  const pageState = usePageStore.getState();
  const dbState = useDatabaseStore.getState();
  const settings = useSettingsStore.getState();
  const commentState = useBlockCommentStore.getState();
  const pages = Object.fromEntries(
    Object.entries(pageState.pages).filter(([, page]) => !isLCSchedulerDatabaseId(page.databaseId)),
  );
  const databases = Object.fromEntries(
    Object.entries(dbState.databases).filter(([databaseId]) => !isLCSchedulerDatabaseId(databaseId)),
  );
  const comments = commentState.messages.filter(
    (message) => message.workspaceId == null || message.workspaceId === workspaceId,
  );
  if (Object.keys(pages).length === 0 && Object.keys(databases).length === 0) {
    workspaceSnapshotById.delete(workspaceId);
    persistWorkspaceSnapshot(workspaceId, null);
    return;
  }
  const snapshot = {
    pages: cloneSnapshot(pages),
    databases: cloneSnapshot(databases),
    activePageId: pageState.activePageId,
    tabs: cloneSnapshot(settings.tabs),
    activeTabIndex: settings.activeTabIndex,
    comments: cloneSnapshot(comments),
  };
  workspaceSnapshotById.set(workspaceId, snapshot);
  persistWorkspaceSnapshot(workspaceId, snapshot);
}

export function refreshWorkspaceSnapshot(workspaceId: string | null): void {
  if (!workspaceId) return;
  captureWorkspaceSnapshot(workspaceId);
}

function hasWorkspaceSnapshot(workspaceId: string | null): boolean {
  return !!workspaceId && workspaceSnapshotById.has(workspaceId);
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceSnapshot>;
  return (
    !!candidate.pages &&
    typeof candidate.pages === "object" &&
    !!candidate.databases &&
    typeof candidate.databases === "object" &&
    Array.isArray(candidate.tabs) &&
    Array.isArray(candidate.comments) &&
    typeof candidate.activeTabIndex === "number" &&
    (candidate.activePageId === null || typeof candidate.activePageId === "string")
  );
}

async function readPersistedWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null> {
  try {
    const raw = await zustandStorage.getItem(workspaceSnapshotKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceSnapshot(parsed)) return null;
    const snapshot = cloneSnapshot(parsed);
    workspaceSnapshotById.set(workspaceId, snapshot);
    return snapshot;
  } catch (error) {
    console.warn("[sync] workspace snapshot read failed", { workspaceId, error });
    return null;
  }
}

export function preloadWorkspaceSnapshots(workspaceIds: Array<string | null | undefined>): void {
  const uniqueIds = [...new Set(workspaceIds.filter((id): id is string => Boolean(id)))];
  void Promise.all(
    uniqueIds
      .filter((workspaceId) => workspaceId !== LC_SCHEDULER_WORKSPACE_ID)
      .map((workspaceId) => readPersistedWorkspaceSnapshot(workspaceId)),
  );
}

function applyWorkspaceSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot): void {
  const schedulerPages = Object.fromEntries(
    Object.entries(usePageStore.getState().pages).filter(([, page]) =>
      isLCSchedulerDatabaseId(page.databaseId),
    ),
  );
  const schedulerDatabases = Object.fromEntries(
    Object.entries(useDatabaseStore.getState().databases).filter(([databaseId]) =>
      isLCSchedulerDatabaseId(databaseId),
    ),
  );
  const pages = { ...cloneSnapshot(snapshot.pages), ...schedulerPages };
  const databases = { ...cloneSnapshot(snapshot.databases), ...schedulerDatabases };
  const tabs = snapshot.tabs.length > 0 ? cloneSnapshot(snapshot.tabs) : [{ pageId: null }];
  const activeTabIndex = Math.min(
    Math.max(snapshot.activeTabIndex, 0),
    Math.max(tabs.length - 1, 0),
  );
  usePageStore.setState({
    pages,
    activePageId: snapshot.activePageId,
    cacheWorkspaceId: workspaceId,
  });
  useDatabaseStore.setState({
    databases,
    cacheWorkspaceId: workspaceId,
  });
  useSettingsStore.setState({
    tabs,
    activeTabIndex,
  });
  useBlockCommentStore.setState({
    messages: cloneSnapshot(snapshot.comments),
  });
}

function restoreWorkspaceSnapshotFromMemory(workspaceId: string): boolean {
  const snapshot = workspaceSnapshotById.get(workspaceId);
  if (!snapshot) return false;
  applyWorkspaceSnapshot(workspaceId, snapshot);
  return true;
}

async function restoreWorkspaceSnapshot(workspaceId: string): Promise<boolean> {
  if (restoreWorkspaceSnapshotFromMemory(workspaceId)) return true;
  const snapshot = await readPersistedWorkspaceSnapshot(workspaceId);
  if (!snapshot) return false;
  applyWorkspaceSnapshot(workspaceId, snapshot);
  return true;
}

// 워크스페이스 전환 시 이전 워크스페이스에 속하던 페이지/DB 캐시를 제거한다.
// 로컬 스토어는 workspaceId 스코프가 없는 평면 맵이라, 새 워크스페이스 데이터를
// fetch 하기 전에 비워야 두 워크스페이스 데이터가 섞여 보이는 현상을 막을 수 있다.
//
// 안전 장치: outbox 에 미전송 mutation 이 있으면 클리어를 보류한다.
// 그렇지 않으면 서버에 도달하지 못한 새 페이지가 영구 손실된다.
//
function hasLocalWorkspaceCache(): boolean {
  const hasNonSchedulerPages = Object.values(usePageStore.getState().pages).some(
    (page) => !isLCSchedulerDatabaseId(page.databaseId),
  );
  const hasNonSchedulerDatabases = Object.keys(useDatabaseStore.getState().databases).some(
    (databaseId) => !isLCSchedulerDatabaseId(databaseId),
  );
  return (
    hasNonSchedulerPages ||
    hasNonSchedulerDatabases
  );
}

export function cacheBelongsToWorkspace(workspaceId: string): boolean {
  const hasPageCache = Object.values(usePageStore.getState().pages).some(
    (page) => !isLCSchedulerDatabaseId(page.databaseId),
  );
  const hasDatabaseCache = Object.keys(useDatabaseStore.getState().databases).some(
    (databaseId) => !isLCSchedulerDatabaseId(databaseId),
  );
  const pageCacheWorkspaceId = usePageStore.getState().cacheWorkspaceId;
  const databaseCacheWorkspaceId = useDatabaseStore.getState().cacheWorkspaceId;
  if (hasPageCache && pageCacheWorkspaceId !== workspaceId) return false;
  if (hasDatabaseCache && databaseCacheWorkspaceId !== workspaceId) return false;
  return hasPageCache || hasDatabaseCache;
}

export function workspaceCacheNeedsPrepaintClear(workspaceId: string | null): boolean {
  if (hasWorkspaceSnapshot(workspaceId)) return false;
  return Boolean(
    workspaceId && hasLocalWorkspaceCache() && !cacheBelongsToWorkspace(workspaceId),
  );
}

export function clearWorkspaceScopedStores(nextWorkspaceId: string): void {
  const schedulerPages = Object.fromEntries(
    Object.entries(usePageStore.getState().pages).filter(([, page]) =>
      isLCSchedulerDatabaseId(page.databaseId),
    ),
  );
  const schedulerDatabases = Object.fromEntries(
    Object.entries(useDatabaseStore.getState().databases).filter(([databaseId]) =>
      isLCSchedulerDatabaseId(databaseId),
    ),
  );
  usePageStore.setState({
    pages: schedulerPages,
    activePageId: null,
    cacheWorkspaceId: nextWorkspaceId,
  });
  useDatabaseStore.setState({
    databases: schedulerDatabases,
    cacheWorkspaceId: nextWorkspaceId,
  });
  useSettingsStore.setState({
    tabs: [{ pageId: null }],
    activeTabIndex: 0,
  });
  useBlockCommentStore.getState().clearMessages();
}

// prev=null 은 부트스트랩 첫 실행(세션 시작·새로고침 직후)을 의미한다.
// 구버전 캐시(cacheWorkspaceId 없음) 또는 다른 워크스페이스 캐시는 첫 페인트 전에 제거한다.
// 같은 워크스페이스임을 확인할 수 있는 캐시만 유지하여 빈 화면과 데이터 오염을 모두 피한다.
export async function applyWorkspaceSwitch(
  prev: string | null,
  next: string | null,
): Promise<{ cleared: boolean; reason: string; pending: number }> {
  if (!next) return { cleared: false, reason: "missing-next-workspace", pending: 0 };
  if (prev) captureWorkspaceSnapshot(prev);
  const initialCacheMismatch =
    prev === null && workspaceCacheNeedsPrepaintClear(next);
  if (prev === next && !initialCacheMismatch) {
    return { cleared: false, reason: "same-workspace", pending: 0 };
  }
  if (prev === null && !initialCacheMismatch) {
    return { cleared: false, reason: "initial-bootstrap", pending: 0 };
  }
  if (restoreWorkspaceSnapshotFromMemory(next)) {
    return { cleared: false, reason: "restored-snapshot", pending: 0 };
  }
  if (await restoreWorkspaceSnapshot(next)) {
    return { cleared: false, reason: "restored-snapshot", pending: 0 };
  }
  let pending = 0;
  try {
    const engine = await getSyncEngine();
    const snapshot = (await engine.debugSnapshot()) as Array<{ workspaceId?: string | null }>;
    pending = snapshot.filter((entry) => {
      const ws = typeof entry.workspaceId === "string" ? entry.workspaceId : null;
      // LC 스케줄러 공용 outbox 항목은 일반 워크스페이스 캐시 전환 보류 사유에서 제외한다.
      if (ws === LC_SCHEDULER_WORKSPACE_ID) return false;
      return true;
    }).length;
  } catch {
    /* outbox 조회 실패 시 클리어 보류 쪽으로 안전 처리 */
  }
  if (pending > 0) {
    console.warn(
      "[sync] outbox 미전송 mutation 으로 워크스페이스 캐시 클리어 보류 (데이터 손실 방지). 강제 비우려면 콘솔에서 `await __QN_clearOutbox()`.",
      { pending },
    );
    return { cleared: false, reason: "pending-outbox", pending };
  }
  if (prev !== null) {
    return { cleared: false, reason: "deferred-switch", pending: 0 };
  }
  clearWorkspaceScopedStores(next);
  return {
    cleared: true,
    reason: initialCacheMismatch ? "initial-cache-mismatch" : "switched",
    pending: 0,
  };
}
