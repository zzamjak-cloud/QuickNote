import { usePageStore, isFullPageDatabaseHomePage } from "../../store/pageStore";
import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { usePageMetaRemoteStore } from "../../store/pageMetaRemoteStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { FavoritePageMeta } from "../../store/settingsStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import type { BlockCommentMsg } from "../../store/blockCommentStore";
import type { WorkspaceSummary } from "../../store/workspaceStore";
import { zustandStorage } from "../storage/index";
import { getSyncEngine } from "./runtime";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import { isProtectedDatabaseId } from "../scheduler/database";
import { createLocalDeleteGuardChecker } from "./localDeleteGuards";

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
const EMPTY_PAGE_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function workspaceSnapshotKey(workspaceId: string): string {
  return `${WORKSPACE_SNAPSHOT_KEY_PREFIX}${workspaceId}`;
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function updatedAtIso(updatedAt: unknown): string {
  const ms = typeof updatedAt === "number" && Number.isFinite(updatedAt)
    ? updatedAt
    : Date.now();
  return new Date(ms).toISOString();
}

function filterLocalDeletedSnapshotPages(
  workspaceId: string,
  pages: WorkspaceSnapshot["pages"],
): WorkspaceSnapshot["pages"] {
  const shouldIgnore = createLocalDeleteGuardChecker();
  let changed = false;
  const next: WorkspaceSnapshot["pages"] = {};
  for (const [pageId, page] of Object.entries(pages)) {
    const pageWorkspaceId = page.workspaceId ?? workspaceId;
    if (
      shouldIgnore(
        "page",
        page.id || pageId,
        pageWorkspaceId,
        updatedAtIso(page.updatedAt),
      )
    ) {
      changed = true;
      continue;
    }
    next[pageId] = page;
  }
  return changed ? next : pages;
}

function filterLocalDeletedSnapshotDatabases(
  workspaceId: string,
  databases: WorkspaceSnapshot["databases"],
): WorkspaceSnapshot["databases"] {
  const shouldIgnore = createLocalDeleteGuardChecker();
  let changed = false;
  const next: WorkspaceSnapshot["databases"] = {};
  for (const [databaseId, database] of Object.entries(databases)) {
    const databaseWorkspaceId = database.meta.workspaceId ?? workspaceId;
    if (
      shouldIgnore(
        "database",
        database.meta.id || databaseId,
        databaseWorkspaceId,
        updatedAtIso(database.meta.updatedAt),
      )
    ) {
      changed = true;
      continue;
    }
    next[databaseId] = database;
  }
  return changed ? next : databases;
}

function normalizeSnapshotTabs(
  tabs: WorkspaceSnapshot["tabs"],
  pages: WorkspaceSnapshot["pages"],
  databases: WorkspaceSnapshot["databases"],
): WorkspaceSnapshot["tabs"] {
  return tabs.map((tab) => {
    const pageId = tab.pageId && pages[tab.pageId] ? tab.pageId : null;
    const databaseId =
      tab.databaseId && databases[tab.databaseId] ? tab.databaseId : null;
    return {
      ...tab,
      pageId: databaseId ? null : pageId,
      databaseId,
      back: tab.back?.filter((id) => pages[id]),
    };
  });
}

function favoriteMetaFromSnapshotPage(
  workspaceId: string,
  workspaceName: string,
  pageId: string,
  snapshot: WorkspaceSnapshot,
): FavoritePageMeta | null {
  const page = snapshot.pages[pageId];
  if (!page) return null;
  return {
    pageId,
    workspaceId,
    workspaceName,
    pageTitle: page.title || "제목 없음",
    pageIcon: page.icon ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isLikelyEmptyPlaceholderDoc(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "doc") return true;
  const content = Array.isArray(value.content) ? value.content : [];
  if (content.length === 0) return true;
  if (content.length !== 1) return false;
  const first = content[0];
  if (!isRecord(first) || first.type !== "paragraph") return false;
  if (typeof first.text === "string" && first.text.length > 0) return false;
  return !Array.isArray(first.content) || first.content.length === 0;
}

function sanitizeWorkspacePages(
  pages: WorkspaceSnapshot["pages"],
): WorkspaceSnapshot["pages"] {
  const sanitized: WorkspaceSnapshot["pages"] = {};
  for (const [pageId, rawPage] of Object.entries(pages)) {
    if (!isRecord(rawPage)) continue;
    const nextId = typeof rawPage.id === "string" && rawPage.id ? rawPage.id : pageId;
    const nextTitle = typeof rawPage.title === "string" ? rawPage.title : "제목 없음";
    const nextDoc = isRecord(rawPage.doc) ? cloneSnapshot(rawPage.doc) : cloneSnapshot(EMPTY_PAGE_DOC);
    const nextParentId = typeof rawPage.parentId === "string" ? rawPage.parentId : null;
    const nextPage = {
      ...rawPage,
      id: nextId,
      title: nextTitle,
      icon: typeof rawPage.icon === "string" ? rawPage.icon : null,
      doc: nextDoc,
      parentId: nextParentId,
      order: toFiniteNumber(rawPage.order, 0),
      createdAt: toFiniteNumber(rawPage.createdAt, Date.now()),
      updatedAt: toFiniteNumber(rawPage.updatedAt, Date.now()),
      databaseId: typeof rawPage.databaseId === "string" ? rawPage.databaseId : undefined,
      dbCells: isRecord(rawPage.dbCells)
        ? cloneSnapshot(rawPage.dbCells)
        : undefined,
      coverImage: typeof rawPage.coverImage === "string"
        ? rawPage.coverImage
        : rawPage.coverImage === null
          ? null
          : undefined,
      blockComments: isRecord(rawPage.blockComments)
        ? cloneSnapshot(rawPage.blockComments)
        : undefined,
      createdByMemberId: typeof rawPage.createdByMemberId === "string"
        ? rawPage.createdByMemberId
        : undefined,
      contentLoaded: typeof rawPage.contentLoaded === "boolean"
        ? rawPage.contentLoaded
        : !isLikelyEmptyPlaceholderDoc(nextDoc),
    };
    sanitized[nextId] = nextPage;
  }
  return sanitized;
}

function sanitizeWorkspaceDatabases(
  databases: WorkspaceSnapshot["databases"],
): WorkspaceSnapshot["databases"] {
  const sanitized: WorkspaceSnapshot["databases"] = {};
  for (const [databaseId, rawBundle] of Object.entries(databases)) {
    if (!isRecord(rawBundle)) continue;
    const rawMeta: Record<string, unknown> = isRecord(rawBundle.meta) ? rawBundle.meta : {};
    const metaId =
      typeof rawMeta.id === "string" && rawMeta.id ? rawMeta.id : databaseId;
    const rawColumns: unknown[] = Array.isArray(rawBundle.columns)
      ? (rawBundle.columns as unknown[])
      : [];
    const columns: WorkspaceSnapshot["databases"][string]["columns"] = [];
    for (const rawColumn of rawColumns) {
      if (!isRecord(rawColumn)) continue;
      if (
        typeof rawColumn.id !== "string" ||
        typeof rawColumn.name !== "string" ||
        typeof rawColumn.type !== "string"
      ) {
        continue;
      }
      columns.push({
        ...rawColumn,
        id: rawColumn.id,
        name: rawColumn.name,
        type: rawColumn.type as WorkspaceSnapshot["databases"][string]["columns"][number]["type"],
        width:
          typeof rawColumn.width === "number" && Number.isFinite(rawColumn.width)
            ? rawColumn.width
            : undefined,
        config: isRecord(rawColumn.config) ? cloneSnapshot(rawColumn.config) : undefined,
      });
    }
    if (columns.length === 0) {
      columns.push({
        id: "title",
        name: "제목",
        type: "title",
        width: undefined,
        config: undefined,
      });
    }
    const rowPageOrder = Array.isArray(rawBundle.rowPageOrder)
      ? rawBundle.rowPageOrder.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const nextBundle: WorkspaceSnapshot["databases"][string] = {
      ...rawBundle,
      meta: {
        ...rawMeta,
        id: metaId,
        title: typeof rawMeta.title === "string" ? rawMeta.title : "데이터베이스",
        createdAt: toFiniteNumber(rawMeta.createdAt, Date.now()),
        updatedAt: toFiniteNumber(rawMeta.updatedAt, Date.now()),
      },
      columns,
      rowPageOrder,
    };
    sanitized[metaId] = nextBundle;
  }
  return sanitized;
}

function sanitizeWorkspaceTabs(
  tabs: WorkspaceSnapshot["tabs"],
  pages: WorkspaceSnapshot["pages"],
): WorkspaceSnapshot["tabs"] {
  const pageIds = new Set(Object.keys(pages));
  const rawTabs: unknown[] = Array.isArray(tabs) ? (tabs as unknown[]) : [];
  const sanitized = rawTabs
    .filter((tab): tab is Record<string, unknown> => isRecord(tab))
    .map((tab) => {
      const nextPageId =
        typeof tab.pageId === "string" && pageIds.has(tab.pageId) ? tab.pageId : null;
      const nextBack = Array.isArray(tab.back)
        ? tab.back.filter((pageId): pageId is string => typeof pageId === "string" && pageIds.has(pageId))
        : undefined;
      return {
        pageId: nextPageId,
        back: nextBack && nextBack.length > 0 ? nextBack : undefined,
      };
    });
  return sanitized.length > 0 ? sanitized : [{ pageId: null }];
}

function sanitizeWorkspaceComments(
  comments: WorkspaceSnapshot["comments"],
): WorkspaceSnapshot["comments"] {
  if (!Array.isArray(comments)) return [];
  const rawComments: unknown[] = comments as unknown[];
  return rawComments
    .filter((comment): comment is Record<string, unknown> => isRecord(comment))
    .filter(
      (comment) =>
        typeof comment.id === "string" &&
        typeof comment.pageId === "string" &&
        typeof comment.blockId === "string" &&
        typeof comment.authorMemberId === "string" &&
        typeof comment.bodyText === "string" &&
        (typeof comment.parentId === "string" || comment.parentId === null),
    )
    .map((comment) => ({
      id: comment.id as string,
      workspaceId:
        typeof comment.workspaceId === "string" ? comment.workspaceId : null,
      pageId: comment.pageId as string,
      blockId: comment.blockId as string,
      authorMemberId: comment.authorMemberId as string,
      bodyText: comment.bodyText as string,
      mentionMemberIds: Array.isArray(comment.mentionMemberIds)
        ? comment.mentionMemberIds.filter((memberId): memberId is string => typeof memberId === "string")
        : [],
      parentId: (comment.parentId as string | null) ?? null,
      createdAt: toFiniteNumber(comment.createdAt, Date.now()),
    }));
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot | null {
  const pages = sanitizeWorkspacePages(snapshot.pages);
  const databases = sanitizeWorkspaceDatabases(snapshot.databases);
  if (Object.keys(pages).length === 0 && Object.keys(databases).length === 0) {
    return null;
  }
  const tabs = sanitizeWorkspaceTabs(snapshot.tabs, pages);
  const safeActiveTabIndex = Number.isInteger(snapshot.activeTabIndex)
    ? Math.min(Math.max(snapshot.activeTabIndex, 0), Math.max(tabs.length - 1, 0))
    : 0;
  const activePageId =
    typeof snapshot.activePageId === "string" && pages[snapshot.activePageId]
      ? snapshot.activePageId
      : tabs[safeActiveTabIndex]?.pageId ?? null;
  const comments = sanitizeWorkspaceComments(snapshot.comments);
  return {
    pages,
    databases,
    tabs,
    activeTabIndex: safeActiveTabIndex,
    activePageId,
    comments,
  };
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

function filterPagesForWorkspaceSnapshot(
  workspaceId: string,
  pages: WorkspaceSnapshot["pages"],
): WorkspaceSnapshot["pages"] {
  if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) {
    // LC스케줄러 스냅샷은 반드시 LC스케줄러 소속 페이지만 포함.
    // workspaceId 가 명시적으로 lc-scheduler-global 이거나
    // databaseId 가 스케줄러 DB인 행 페이지를 허용한다.
    // 과거 캐시에는 workspaceId 가 없는 일반 LC 페이지가 남아 있을 수 있어 함께 보존한다.
    return Object.fromEntries(
      Object.entries(pages).filter(
        ([, page]) =>
          isProtectedDatabaseId(page.databaseId) ||
          page.workspaceId === LC_SCHEDULER_WORKSPACE_ID ||
          (page.workspaceId == null && !page.databaseId),
      ),
    );
  }
  // 다른 워크스페이스 스냅샷에는 LC스케줄러 전용 페이지를 포함하지 않는다.
  return Object.fromEntries(
    Object.entries(pages).filter(
      ([, page]) =>
        !isProtectedDatabaseId(page.databaseId) &&
        page.workspaceId !== LC_SCHEDULER_WORKSPACE_ID,
    ),
  );
}

function filterDatabasesForWorkspaceSnapshot(
  workspaceId: string,
  databases: WorkspaceSnapshot["databases"],
): WorkspaceSnapshot["databases"] {
  if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) return { ...databases };
  return Object.fromEntries(
    Object.entries(databases).filter(([databaseId]) => !isProtectedDatabaseId(databaseId)),
  );
}

function captureWorkspaceSnapshot(workspaceId: string): void {
  if (!workspaceId) return;
  const pageState = usePageStore.getState();
  const dbState = useDatabaseStore.getState();
  const settings = useSettingsStore.getState();
  const commentState = useBlockCommentStore.getState();
  const pages = filterPagesForWorkspaceSnapshot(workspaceId, pageState.pages);
  const databases = filterDatabasesForWorkspaceSnapshot(workspaceId, dbState.databases);
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
  const key = workspaceSnapshotKey(workspaceId);
  try {
    const raw = await zustandStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceSnapshot(parsed)) {
      workspaceSnapshotById.delete(workspaceId);
      await zustandStorage.removeItem(key);
      return null;
    }
    const normalized = normalizeWorkspaceSnapshot(cloneSnapshot(parsed));
    if (!normalized) {
      workspaceSnapshotById.delete(workspaceId);
      await zustandStorage.removeItem(key);
      return null;
    }
    const snapshot = cloneSnapshot(normalized);
    workspaceSnapshotById.set(workspaceId, snapshot);
    persistWorkspaceSnapshot(workspaceId, snapshot);
    return snapshot;
  } catch (error) {
    console.warn("[sync] workspace snapshot read failed", { workspaceId, error });
    workspaceSnapshotById.delete(workspaceId);
    await zustandStorage.removeItem(key);
    return null;
  }
}

export function preloadWorkspaceSnapshots(workspaceIds: Array<string | null | undefined>): void {
  const uniqueIds = [...new Set(workspaceIds.filter((id): id is string => Boolean(id)))];
  void Promise.all(
    uniqueIds.map((workspaceId) =>
      readPersistedWorkspaceSnapshot(workspaceId).catch((err) => {
        console.warn("[cache] preloadWorkspaceSnapshots failed", { workspaceId, err });
      }),
    ),
  );
}

export function getFavoritePageMetaFromLoadedWorkspaceSnapshots(
  pageId: string,
  workspaces: readonly WorkspaceSummary[],
): FavoritePageMeta | null {
  for (const workspace of workspaces) {
    const snapshot = workspaceSnapshotById.get(workspace.workspaceId);
    if (!snapshot) continue;
    const meta = favoriteMetaFromSnapshotPage(
      workspace.workspaceId,
      workspace.name,
      pageId,
      snapshot,
    );
    if (meta) return meta;
  }
  return null;
}

export async function resolveFavoritePageMetaFromWorkspaceSnapshots(
  pageId: string,
  workspaces: readonly WorkspaceSummary[],
): Promise<FavoritePageMeta | null> {
  const loaded = getFavoritePageMetaFromLoadedWorkspaceSnapshots(pageId, workspaces);
  if (loaded) return loaded;
  for (const workspace of workspaces) {
    const snapshot = await readPersistedWorkspaceSnapshot(workspace.workspaceId);
    if (!snapshot) continue;
    const meta = favoriteMetaFromSnapshotPage(
      workspace.workspaceId,
      workspace.name,
      pageId,
      snapshot,
    );
    if (meta) return meta;
  }
  return null;
}

function applyWorkspaceSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot): boolean {
  const normalized = normalizeWorkspaceSnapshot(snapshot);
  if (!normalized) {
    workspaceSnapshotById.delete(workspaceId);
    persistWorkspaceSnapshot(workspaceId, null);
    return false;
  }
  const schedulerPages = Object.fromEntries(
    Object.entries(usePageStore.getState().pages).filter(([, page]) =>
      isProtectedDatabaseId(page.databaseId),
    ),
  );
  const schedulerDatabases = Object.fromEntries(
    Object.entries(useDatabaseStore.getState().databases).filter(([databaseId]) =>
      isProtectedDatabaseId(databaseId),
    ),
  );
  const snapshotPages = workspaceId === LC_SCHEDULER_WORKSPACE_ID
    ? cloneSnapshot(normalized.pages)
    : { ...cloneSnapshot(normalized.pages), ...schedulerPages };
  const snapshotDatabases = workspaceId === LC_SCHEDULER_WORKSPACE_ID
    ? cloneSnapshot(normalized.databases)
    : { ...cloneSnapshot(normalized.databases), ...schedulerDatabases };
  const pages = filterLocalDeletedSnapshotPages(workspaceId, snapshotPages);
  const databases = filterLocalDeletedSnapshotDatabases(workspaceId, snapshotDatabases);
  const rawTabs = normalized.tabs.length > 0 ? cloneSnapshot(normalized.tabs) : [{ pageId: null }];
  const tabs = normalizeSnapshotTabs(rawTabs, pages, databases);
  const activePageId =
    normalized.activePageId && pages[normalized.activePageId]
      ? normalized.activePageId
      : null;
  const activeTabIndex = Math.min(
    Math.max(normalized.activeTabIndex, 0),
    Math.max(tabs.length - 1, 0),
  );
  usePageStore.setState({
    pages,
    activePageId,
    cacheWorkspaceId: workspaceId,
  });
  useDatabaseStore.setState({
    databases,
    cacheWorkspaceId: workspaceId,
  });
  useSettingsStore.setState({
    tabs,
    activeTabIndex,
    lastClosedTab: null,
  });
  useBlockCommentStore.setState({
    messages: cloneSnapshot(normalized.comments),
  });
  return true;
}

function restoreWorkspaceSnapshotFromMemory(workspaceId: string): boolean {
  const snapshot = workspaceSnapshotById.get(workspaceId);
  if (!snapshot) return false;
  return applyWorkspaceSnapshot(workspaceId, snapshot);
}

async function restoreWorkspaceSnapshot(workspaceId: string): Promise<boolean> {
  if (restoreWorkspaceSnapshotFromMemory(workspaceId)) return true;
  const snapshot = await readPersistedWorkspaceSnapshot(workspaceId);
  if (!snapshot) return false;
  return applyWorkspaceSnapshot(workspaceId, snapshot);
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
    (page) => !isProtectedDatabaseId(page.databaseId),
  );
  const hasNonSchedulerDatabases = Object.keys(useDatabaseStore.getState().databases).some(
    (databaseId) => !isProtectedDatabaseId(databaseId),
  );
  return (
    hasNonSchedulerPages ||
    hasNonSchedulerDatabases
  );
}

export function cacheBelongsToWorkspace(workspaceId: string): boolean {
  const hasPageCache = Object.values(usePageStore.getState().pages).some(
    (page) => !isProtectedDatabaseId(page.databaseId),
  );
  const hasDatabaseCache = Object.keys(useDatabaseStore.getState().databases).some(
    (databaseId) => !isProtectedDatabaseId(databaseId),
  );
  const pageCacheWorkspaceId = usePageStore.getState().cacheWorkspaceId;
  const databaseCacheWorkspaceId = useDatabaseStore.getState().cacheWorkspaceId;
  if (hasPageCache && pageCacheWorkspaceId !== workspaceId) return false;
  if (hasDatabaseCache && databaseCacheWorkspaceId !== workspaceId) return false;
  return hasPageCache || hasDatabaseCache;
}

export function workspaceHasPageContentCache(workspaceId: string): boolean {
  const state = usePageStore.getState();
  if (state.cacheWorkspaceId !== workspaceId) return false;
  return Object.values(state.pages).some((page) => {
    if (page.workspaceId && page.workspaceId !== workspaceId) return false;
    if (page.contentLoaded === false) return false;
    if (page.contentLoaded !== true && isLikelyEmptyPlaceholderDoc(page.doc)) return false;
    if (page.databaseId) return false;
    if (isFullPageDatabaseHomePage(page)) return false;
    return true;
  });
}

export function workspaceHasStructureCache(workspaceId: string): boolean {
  const tokens = usePageMetaRemoteStore.getState().nextTokenByWorkspaceId;
  if (!Object.prototype.hasOwnProperty.call(tokens, workspaceId)) return false;
  if (tokens[workspaceId] !== null) return false;
  return cacheBelongsToWorkspace(workspaceId);
}

export function workspaceCacheNeedsPrepaintClear(workspaceId: string | null): boolean {
  if (hasWorkspaceSnapshot(workspaceId)) return false;
  return Boolean(
    workspaceId && hasLocalWorkspaceCache() && !cacheBelongsToWorkspace(workspaceId),
  );
}

export function clearWorkspaceScopedStores(nextWorkspaceId: string): void {
  const currentPages = usePageStore.getState().pages;
  const activePageId = usePageStore.getState().activePageId;
  const activeSchedulerPageId =
    nextWorkspaceId === LC_SCHEDULER_WORKSPACE_ID &&
    activePageId &&
    (isProtectedDatabaseId(currentPages[activePageId]?.databaseId) ||
      currentPages[activePageId]?.workspaceId === LC_SCHEDULER_WORKSPACE_ID)
      ? activePageId
      : null;
  const schedulerPages = Object.fromEntries(
    Object.entries(currentPages).filter(
      ([, page]) =>
        isProtectedDatabaseId(page.databaseId) ||
        page.workspaceId === LC_SCHEDULER_WORKSPACE_ID,
    ),
  );
  const schedulerDatabases = Object.fromEntries(
    Object.entries(useDatabaseStore.getState().databases).filter(([databaseId]) =>
      isProtectedDatabaseId(databaseId),
    ),
  );
  usePageStore.setState({
    pages: schedulerPages,
    activePageId: activeSchedulerPageId,
    cacheWorkspaceId: nextWorkspaceId,
  });
  useDatabaseStore.setState({
    databases: schedulerDatabases,
    cacheWorkspaceId: nextWorkspaceId,
  });
  useSettingsStore.setState({
    tabs: [{ pageId: activeSchedulerPageId }],
    activeTabIndex: 0,
    lastClosedTab: null,
  });
  useBlockCommentStore.getState().clearMessages();
  usePageContentLoadStore.getState().clear();
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
