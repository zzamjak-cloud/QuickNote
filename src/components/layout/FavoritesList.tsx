// 개인 즐겨찾기 목록 — DnD 정렬

import { useCallback, useEffect } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StarOff } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "../../store/settingsStore";
import type { FavoritePageMeta } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { WorkspaceSummary } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { fetchPagesByWorkspace } from "../../lib/sync";
import {
  getFavoritePageMetaFromLoadedWorkspaceSnapshots,
  resolveFavoritePageMetaFromWorkspaceSnapshots,
} from "../../lib/sync/workspaceSwitch";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { getRevokedFavoritePageIds } from "./favoritesAccess";
import { openPageInCurrentTab } from "../../lib/navigation/internalNavigation";
import { ensurePageContentLoaded } from "../../lib/sync/pageContentLoad";
import {
  requestCrossWorkspaceLanding,
  clearCrossWorkspaceLanding,
} from "../../lib/sync/workspaceLanding";

const FAVORITE_NAV_TIMEOUT_MS = 6000;

async function resolveFavoritePageMeta(
  pageId: string,
  workspaces: readonly WorkspaceSummary[],
  preferWorkspaceId?: string | null,
): Promise<FavoritePageMeta | null> {
  const cached = await resolveFavoritePageMetaFromWorkspaceSnapshots(pageId, workspaces);
  if (cached) return cached;

  // 현재 워크스페이스를 먼저 조회해 흔한 경우를 1회 페치로 끝낸다(#4).
  // (이전: 전 워크스페이스를 순서대로 풀페치 → 페이지가 마지막 워크스페이스에 있으면 전부 페치)
  const ordered = preferWorkspaceId
    ? [
        ...workspaces.filter((w) => w.workspaceId === preferWorkspaceId),
        ...workspaces.filter((w) => w.workspaceId !== preferWorkspaceId),
      ]
    : workspaces;

  for (const workspace of ordered) {
    try {
      const pages = await fetchPagesByWorkspace(workspace.workspaceId);
      const page = pages.find((candidate) => candidate.id === pageId && !candidate.deletedAt);
      if (!page) continue;
      return {
        pageId,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        pageTitle: page.title || "제목 없음",
        pageIcon: page.icon ?? null,
      };
    } catch {
      // 접근 권한이 없는 워크스페이스는 다음 후보를 확인한다.
    }
  }
  return null;
}

function FavoriteRow({ pageId }: { pageId: string }) {
  // doc 필드 불필요 — title·icon·존재 여부만 구독해 텍스트 입력 시 리렌더 방지
  const pageMeta = usePageStore(
    useShallow((s) => {
      const p = s.pages[pageId];
      if (!p) return null;
      return { title: p.title, icon: p.icon };
    }),
  );
  const removeFavoritePage = useSettingsStore((s) => s.removeFavoritePage);
  const updateFavoritePageMeta = useSettingsStore((s) => s.updateFavoritePageMeta);
  const favoriteMeta = useSettingsStore((s) => s.favoritePageMetaById[pageId]);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const requestFavoriteNavigation = useUiStore((s) => s.requestFavoriteNavigation);
  const closePeek = useUiStore((s) => s.closePeek);
  // 워크스페이스 스냅샷(방문 시 라이브 pageStore 로 갱신됨)이 favoriteMeta 캐시(즐겨찾기 시점 1회
  // 기록)보다 신선하므로 우선한다. 캐시만 믿으면 다른 워크스페이스에서 변경 전 제목이 표시된다.
  const snapshotMeta =
    getFavoritePageMetaFromLoadedWorkspaceSnapshots(pageId, workspaces) ??
    favoriteMeta ??
    null;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pageId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex min-h-7 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80"
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => {
          void (async () => {
            closePeek();
            // 1) 페이지 본문을 store 에 확보 — workspaceId 를 넘기지 않아 서버가 페이지의 실제
            //    소속으로 해석(fetchPageByIdOnly)한다. 스냅샷의 workspaceId 가 틀려도 안전하다.
            //    (스냅샷 workspaceId 로 fetchPageById 하면 값이 어긋날 때 null → 로드 실패했음)
            const loaded = await ensurePageContentLoaded({
              pageId,
              source: "favorite-nav",
            });
            if (!loaded) {
              showToast("페이지를 불러오지 못했습니다.", { kind: "error" });
              return;
            }
            // 2) 로드된 페이지의 권위 있는 워크스페이스로 판정.
            const loadedPage = usePageStore.getState().pages[pageId];
            const targetWorkspaceId = loadedPage?.workspaceId ?? null;

            // 3) 같은 워크스페이스(또는 미상): 현재 탭에서 연다.
            if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) {
              openPageInCurrentTab(pageId, { workspaceId: targetWorkspaceId });
              return;
            }

            // 4) 다른 워크스페이스: 접근 확인 후 결정적 착지로 전환.
            const workspace = workspaces.find(
              (w) => w.workspaceId === targetWorkspaceId,
            );
            if (!workspace) {
              // 워크스페이스 목록 미로드(부트스트랩 레이스): 로드 후 재시도 대기
              if (workspaces.length === 0) {
                requestFavoriteNavigation({ pageId, workspaceId: targetWorkspaceId });
                return;
              }
              removeFavoritePage(pageId);
              showToast(
                `${snapshotMeta?.workspaceName || "해당 워크스페이스"}에 대한 접근 권한이 없습니다.`,
                { kind: "error" },
              );
              return;
            }
            // 스냅샷 workspaceId 가 어긋나 있었을 수 있으니 실제 소속으로 교정(다음 클릭부터 정상).
            updateFavoritePageMeta(pageId, {
              pageId,
              workspaceId: targetWorkspaceId,
              workspaceName: workspace.name,
              pageTitle: loadedPage?.title || snapshotMeta?.pageTitle || "제목 없음",
              pageIcon: loadedPage?.icon ?? snapshotMeta?.pageIcon ?? null,
            });
            // 페이지 본문은 이미 store 에 있으므로 applyWorkspaceLanding 이 목표로 착지한다.
            // 랜딩 목표는 전환 직전에 설정(다중 클릭 시 스테일 목표 최소화).
            clearCrossWorkspaceLanding();
            requestCrossWorkspaceLanding(targetWorkspaceId, pageId);
            setCurrentWorkspaceId(targetWorkspaceId);
          })();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-zinc-800 dark:text-zinc-100"
      >
        <PageIconDisplay icon={pageMeta?.icon ?? snapshotMeta?.pageIcon ?? null} size="sm" />
        <span className="truncate">{pageMeta?.title || snapshotMeta?.pageTitle || "제목 확인 중"}</span>
      </button>
      <button
        type="button"
        onClick={() => removeFavoritePage(pageId)}
        className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-amber-600 group-hover:opacity-100 dark:hover:bg-zinc-700"
        aria-label="즐겨찾기 해제"
        title="즐겨찾기 해제"
      >
        <StarOff size={14} />
      </button>
    </div>
  );
}

export function FavoritesList() {
  const favoritePageIds = useSettingsStore((s) => s.favoritePageIds);
  const favoritePageMetaById = useSettingsStore((s) => s.favoritePageMetaById);
  const reorderFavorites = useSettingsStore((s) => s.reorderFavorites);
  const updateFavoritePageMeta = useSettingsStore((s) => s.updateFavoritePageMeta);
  const removeFavoritesForPages = useSettingsStore(
    (s) => s.removeFavoritesForPages,
  );
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const pages = usePageStore((s) => s.pages);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const pendingFavoriteNavigation = useUiStore((s) => s.pendingFavoriteNavigation);
  const clearFavoriteNavigation = useUiStore((s) => s.clearFavoriteNavigation);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  useEffect(() => {
    if (favoritePageIds.length === 0 || workspaces.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const pageId of favoritePageIds) {
        if (cancelled) return;
        const page = pages[pageId];
        // 현재 워크스페이스에 로드된 페이지 → 라이브 제목으로 캐시 갱신.
        // (peek 등으로 적재된 타 워크스페이스 페이지는 제외 — 아래 스냅샷 경로에서 정확히 처리)
        const pageWsId = page?.workspaceId ?? null;
        if (page && (pageWsId === null || pageWsId === currentWorkspaceId)) {
          const workspace =
            workspaces.find((w) => w.workspaceId === currentWorkspaceId) ??
            null;
          updateFavoritePageMeta(pageId, {
            pageId,
            workspaceId: currentWorkspaceId,
            workspaceName: workspace?.name ?? "",
            pageTitle: page.title || "제목 없음",
            pageIcon: page.icon ?? null,
          });
          continue;
        }
        // 다른 워크스페이스: 워크스페이스 스냅샷에서 실제 제목을 찾아 스테일 캐시(변경 전 제목)를 교정.
        // 캐시에 workspaceId 가 이미 있어도 제목/아이콘이 다르면 갱신한다(예전엔 여기서 건너뛰어
        // 변경 전 제목이 계속 표시됐음). updateFavoritePageMeta 의 same 가드로 중복 쓰기는 없다.
        const fromSnapshot = getFavoritePageMetaFromLoadedWorkspaceSnapshots(
          pageId,
          workspaces,
        );
        if (fromSnapshot) {
          updateFavoritePageMeta(pageId, fromSnapshot);
          continue;
        }
        if (favoritePageMetaById[pageId]?.workspaceId) continue;
        const meta = await resolveFavoritePageMeta(pageId, workspaces, currentWorkspaceId);
        if (!cancelled && meta) updateFavoritePageMeta(pageId, meta);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentWorkspaceId,
    favoritePageIds,
    favoritePageMetaById,
    pages,
    updateFavoritePageMeta,
    workspaces,
  ]);

  const validIds = favoritePageIds;

  // 접근 권한이 사라진 워크스페이스의 즐겨찾기는 자동 제거
  useEffect(() => {
    if (favoritePageIds.length === 0) return;
    const revoked = getRevokedFavoritePageIds(
      favoritePageIds,
      favoritePageMetaById,
      workspaces,
    );
    if (revoked.length > 0) removeFavoritesForPages(revoked);
  }, [favoritePageIds, favoritePageMetaById, workspaces, removeFavoritesForPages]);

  useEffect(() => {
    if (!pendingFavoriteNavigation) return;
    const { pageId, workspaceId, requestedAt } = pendingFavoriteNavigation;
    if (workspaceId && currentWorkspaceId !== workspaceId) return;
    if (pages[pageId]) {
      setCurrentTabPage(pageId);
      setActivePage(pageId);
      clearFavoriteNavigation();
      return;
    }
    if (Date.now() - requestedAt < FAVORITE_NAV_TIMEOUT_MS) return;
    clearFavoriteNavigation();
    if (workspaceId) {
      removeFavoritesForPages([pageId]);
      showToast("페이지를 찾을 수 없어 즐겨찾기에서 제거했습니다.", { kind: "error" });
    } else {
      showToast("페이지 위치를 아직 확인하지 못했습니다.", { kind: "error" });
    }
  }, [
    pendingFavoriteNavigation,
    currentWorkspaceId,
    pages,
    setCurrentTabPage,
    setActivePage,
    clearFavoriteNavigation,
    removeFavoritesForPages,
    showToast,
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const a = String(active.id);
      const o = String(over.id);
      const oldIndex = validIds.indexOf(a);
      const newIndex = validIds.indexOf(o);
      if (oldIndex < 0 || newIndex < 0) return;
      reorderFavorites(arrayMove(validIds, oldIndex, newIndex));
    },
    [reorderFavorites, validIds],
  );

  if (validIds.length === 0) {
    return (
      <p className="px-1 text-sm text-zinc-400">즐겨찾기한 페이지가 없습니다.</p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={validIds} strategy={verticalListSortingStrategy}>
        {validIds.map((id) => (
          <FavoriteRow key={id} pageId={id} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
