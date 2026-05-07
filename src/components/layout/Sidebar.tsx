import { useCallback, useEffect, useRef, useState } from "react";
import pkg from "../../../package.json";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Search } from "lucide-react";
import {
  resolveSidebarDrop,
  sidebarPageTreeCollision,
  type SidebarDropHint,
  type SidebarDropMode,
} from "../../lib/sidebarPageTreeCollision";
import {
  isDescendant,
  usePageStore,
  filterPageTree,
} from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { PageListGroup } from "./PageListGroup";
import { PageMoveDialog } from "./PageMoveDialog";
import { DatabaseManagerDialog } from "./DatabaseManagerDialog";
import { SidebarHeader } from "../sidebar/SidebarHeader";
import { SettingsModal } from "../settings/SettingsModal";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

type DropTarget = { id: string; mode: SidebarDropMode } | null;

function SidebarDragPreview({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  if (!page) return null;
  return (
    <div className="flex max-w-[15rem] cursor-grabbing select-none items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm shadow-lg ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-800 dark:ring-white/10">
      <span className="shrink-0 text-base leading-none">
        {page.icon ?? "·"}
      </span>
      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
        {page.title || "제목 없음"}
      </span>
    </div>
  );
}

const HOVER_EXPAND_DELAY_MS = 700;
const EDGE_SCROLL_ZONE_PX = 24;
const EDGE_SCROLL_MAX_PER_FRAME = 12;
const APP_VERSION = pkg.version;

export function Sidebar() {
  const pointerRef = useRef({ x: 0, y: 0 });
  const nestHintRef = useRef<SidebarDropHint | null>(null);
  const dropUiRafRef = useRef<number | null>(null);
  const pendingDropRef = useRef<DropTarget | null>(null);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverExpandTargetRef = useRef<string | null>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [dbManagerOpen, setDbManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [dragOverlayId, setDragOverlayId] = useState<string | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const tree = usePageStore((s) => filterPageTree(s, query));
  const createPage = usePageStore((s) => s.createPage);
  const movePage = usePageStore((s) => s.movePage);
  const movePageRelative = usePageStore((s) => s.movePageRelative);
  const pagesMap = usePageStore((s) => s.pages);
  const dndEnabled = query.trim().length === 0;

  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const deletePage = usePageStore((s) => s.deletePage);
  const undoLastDelete = usePageStore((s) => s.undoLastDelete);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      const isInput =
        tag === "INPUT" || tag === "TEXTAREA" || activeEl?.isContentEditable;
      const isEditorFocused =
        activeEl?.classList.contains("ProseMirror") ||
        activeEl?.closest(".ProseMirror") !== null;
      if (isInput || isEditorFocused) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "d" || e.key === "D") && activePageId) {
        e.preventDefault();
        const newId = duplicatePage(activePageId);
        if (newId) setActivePage(newId);
        return;
      }

      // Ctrl/Cmd + Z (shift 없음): 마지막 페이지 삭제 복원.
      // 입력 필드/에디터 focus 시는 위 isInput·isEditorFocused 가드로 이미 return 처리됨 — 여기는 사이드바·빈 영역 focus 한정.
      if (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        const restored = undoLastDelete();
        if (restored) {
          e.preventDefault();
          return;
        }
      }

      // Delete / Backspace: 활성 페이지 삭제 (확인 다이얼로그 경유, 우클릭 메뉴와 동일 흐름).
      // 맥에서는 백스페이스가 Delete 역할을 하므로 둘 다 처리.
      if ((e.key === "Delete" || e.key === "Backspace") && activePageId) {
        e.preventDefault();
        setDeleteTargetId(activePageId);
        return;
      }

      // Alt+Arrows: 페이지 트리 이동 단축키
      if (!e.altKey || !activePageId) return;
      if (e.key === "ArrowUp" && !e.shiftKey) {
        e.preventDefault();
        movePageRelative(activePageId, "up");
      } else if (e.key === "ArrowDown" && !e.shiftKey) {
        e.preventDefault();
        movePageRelative(activePageId, "down");
      } else if (e.key === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        movePageRelative(activePageId, "outdent");
      } else if (e.key === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        movePageRelative(activePageId, "indent");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePageId, duplicatePage, setActivePage, movePageRelative, deletePage, undoLastDelete]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const flushPendingDropPaint = () => {
    dropUiRafRef.current = null;
    const next = pendingDropRef.current;
    setDropTarget((prev) => {
      if (prev === null && next === null) return prev;
      if (prev && next && prev.id === next.id && prev.mode === next.mode)
        return prev;
      if (!prev && !next) return prev;
      return next;
    });
  };

  const clearHoverExpand = () => {
    if (hoverExpandTimerRef.current != null) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    hoverExpandTargetRef.current = null;
  };

  const stopEdgeScroll = () => {
    isDraggingRef.current = false;
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  };

  const edgeScrollLoop = useCallback(() => {
    const tick = () => {
      if (!isDraggingRef.current) {
        scrollRafRef.current = null;
        return;
      }
      const host = scrollHostRef.current;
      if (host) {
        const { y } = pointerRef.current;
        const r = host.getBoundingClientRect();
        let dy = 0;
        if (y < r.top + EDGE_SCROLL_ZONE_PX) {
          const dist = r.top + EDGE_SCROLL_ZONE_PX - y;
          dy = -Math.min(EDGE_SCROLL_MAX_PER_FRAME, dist);
        } else if (y > r.bottom - EDGE_SCROLL_ZONE_PX) {
          const dist = y - (r.bottom - EDGE_SCROLL_ZONE_PX);
          dy = Math.min(EDGE_SCROLL_MAX_PER_FRAME, dist);
        }
        if (dy !== 0) host.scrollTop += dy;
      }
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  /** 드롭 힌트만 제거 (오버레이는 유지) */
  const resetDropIndicator = () => {
    nestHintRef.current = null;
    pendingDropRef.current = null;
    if (dropUiRafRef.current != null) {
      cancelAnimationFrame(dropUiRafRef.current);
      dropUiRafRef.current = null;
    }
    setDropTarget((prev) => (prev == null ? prev : null));
    clearHoverExpand();
  };

  const endDragSession = () => {
    resetDropIndicator();
    stopEdgeScroll();
    setDragOverlayId(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    setDragOverlayId(String(event.active.id));
    isDraggingRef.current = true;
    if (scrollRafRef.current == null) {
      scrollRafRef.current = requestAnimationFrame(edgeScrollLoop);
    }
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over) {
      resetDropIndicator();
      return;
    }
    const overId = String(over.id);
    const activeId = String(active.id);

    const expandedIds = useSettingsStore.getState().expandedIds;
    const isExpanded = (id: string) => expandedIds.includes(id);
    const isBlocked = (candidate: string) =>
      isDescendant(pagesMap, activeId, candidate);

    const hint = resolveSidebarDrop({
      overId,
      activeId,
      clientY: pointerRef.current.y,
      prev: nestHintRef.current,
      isBlocked,
      isExpanded,
    });
    nestHintRef.current = hint;

    pendingDropRef.current = { id: overId, mode: hint.mode };
    if (dropUiRafRef.current == null) {
      dropUiRafRef.current = requestAnimationFrame(flushPendingDropPaint);
    }

    // hover-expand: 같은 over 위에 일정 시간 머무르면 자동 펼침
    if (hint.mode === "disabled") {
      clearHoverExpand();
    } else if (hoverExpandTargetRef.current !== overId) {
      clearHoverExpand();
      hoverExpandTargetRef.current = overId;
      const hasChildren = Object.values(pagesMap).some(
        (p) => p.parentId === overId,
      );
      if (hasChildren && !isExpanded(overId)) {
        hoverExpandTimerRef.current = window.setTimeout(() => {
          useSettingsStore.getState().setExpanded(overId, true);
        }, HOVER_EXPAND_DELAY_MS);
      }
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active } = event;
    const last = nestHintRef.current;
    endDragSession();
    if (!last || last.mode === "disabled") return;
    const activeId = String(active.id);
    const overPage = pagesMap[last.overId];
    const activePage = pagesMap[activeId];
    if (!activePage || !overPage) return;
    if (last.overId === activeId) return;

    if (last.mode === "child-first") {
      movePage(activeId, last.overId, 0);
      return;
    }
    if (last.mode === "child-last") {
      movePage(activeId, last.overId, Number.MAX_SAFE_INTEGER);
      return;
    }
    // before / after
    const targetParent = overPage.parentId;
    const siblings = Object.values(pagesMap)
      .filter((p) => p.parentId === targetParent && p.id !== activeId)
      .sort((a, b) => a.order - b.order);
    const overIndex = siblings.findIndex((p) => p.id === last.overId);
    if (overIndex === -1) return;
    movePage(
      activeId,
      targetParent,
      last.mode === "before" ? overIndex : overIndex + 1,
    );
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 px-2 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <SidebarHeader
        appVersion={APP_VERSION}
        onCreatePage={() => createPage()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus-within:ring-zinc-600">
        <Search size={13} className="text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="페이지 검색"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
          data-search-input="true"
        />
      </div>
      <div ref={scrollHostRef} className="flex-1 overflow-y-auto">
        {tree.length === 0 ? (
          <p className="mt-4 px-2 text-xs text-zinc-400">
            {query
              ? "일치하는 페이지가 없습니다."
              : "+ 버튼으로 페이지를 만드세요."}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={sidebarPageTreeCollision}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={endDragSession}
          >
            <PageListGroup
              nodes={tree}
              depth={0}
              draggable={dndEnabled}
              onMove={setMoveTargetId}
              dropTarget={dropTarget}
            />
            <DragOverlay dropAnimation={null} style={{ zIndex: 60 }}>
              {dragOverlayId ? (
                <SidebarDragPreview pageId={dragOverlayId} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDbManagerOpen(true)}
        className="mt-2 w-full rounded-md border border-zinc-200 px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        데이터베이스 관리
      </button>
      <PageMoveDialog
        pageId={moveTargetId}
        onClose={() => setMoveTargetId(null)}
      />
      <SimpleConfirmDialog
        open={deleteTargetId !== null}
        title="페이지 삭제"
        message={(() => {
          if (!deleteTargetId) return "";
          const target = pagesMap[deleteTargetId];
          const hasChildren = Object.values(pagesMap).some(
            (p) => p.parentId === deleteTargetId,
          );
          return `"${target?.title ?? "제목 없음"}" 페이지를 삭제하시겠습니까?${
            hasChildren ? " 하위 페이지도 함께 삭제됩니다." : ""
          }`;
        })()}
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          if (deleteTargetId) deletePage(deleteTargetId);
          setDeleteTargetId(null);
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
      <DatabaseManagerDialog
        open={dbManagerOpen}
        onClose={() => setDbManagerOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </aside>
  );
}
