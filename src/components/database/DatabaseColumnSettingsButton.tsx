import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import type {
  DatabasePanelState,
  ViewKind,
  ViewSpecificConfig,
} from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";

type Props = {
  databaseId: string;
  viewKind: ViewKind;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 헤더 안에 표 컬럼으로 둘 때(<th>) true. */
  asTh?: boolean;
  /** 인라인/전체페이지 레이아웃 구분 — 항목 표시 섹션에서 사용. */
  layout?: "inline" | "fullPage";
};

/**
 * 컬럼 가시성 + 순서 설정 메뉴 (#6, #9).
 * 뷰별로 viewConfigs[viewKind]에 visibleColumnIds 배열을 저장해 가시성/순서를 함께 관리.
 */
export function DatabaseColumnSettingsButton({
  databaseId,
  viewKind,
  panelState,
  setPanelState,
  asTh,
  layout,
}: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const moveColumn = useDatabaseStore((s) => s.moveColumn);
  const openColumnMenuId = useUiStore((s) => s.openColumnMenuId);
  const setOpenColumnMenu = useUiStore((s) => s.setOpenColumnMenu);
  const menuKey = `settings:${databaseId}:${viewKind}`;
  const open = openColumnMenuId === menuKey;
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 드래그 상태 (로컬)
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpenColumnMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open, setOpenColumnMenu]);

  if (!bundle) return null;

  const cfg: ViewSpecificConfig =
    panelState.viewConfigs?.[viewKind] ?? {};

  const allCols = bundle.columns;
  const titleCol = allCols.find((c) => c.type === "title");
  const visibleSet = resolveVisibleColumnIds(allCols, viewKind, cfg);
  if (titleCol) visibleSet.add(titleCol.id);
  // 표시 설정 리스트는 활성/비활성 여부와 무관하게 실제 컬럼 순서를 따른다.
  const items: { col: typeof allCols[number]; visible: boolean }[] = allCols.map((col) => ({
    col,
    visible: visibleSet.has(col.id),
  }));

  const writeViewCfg = (patch: Partial<ViewSpecificConfig>) => {
    const nextCfg: ViewSpecificConfig = { ...cfg, ...patch };
    setPanelState({
      viewConfigs: { ...(panelState.viewConfigs ?? {}), [viewKind]: nextCfg },
    });
  };

  const toggleVisible = (id: string) => {
    const nextVisible = new Set(visibleSet);
    if (nextVisible.has(id)) nextVisible.delete(id);
    else nextVisible.add(id);
    // title 컬럼은 항상 보이도록 보장.
    if (titleCol) nextVisible.add(titleCol.id);
    const visibleColumnIds = allCols
      .filter((col) => nextVisible.has(col.id))
      .map((col) => col.id);
    writeViewCfg({ visibleColumnIds, hiddenColumnIds: undefined });
  };

  const onDrop = () => {
    if (dragFrom == null || dragOver == null || dragFrom === dragOver) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const next = [...items];
    const [m] = next.splice(dragFrom, 1);
    if (m) next.splice(dragOver, 0, m);
    // 표시 설정에서 순서를 바꾸면 실제 컬럼 순서도 함께 바꾼다.
    moveColumn(databaseId, dragFrom, dragOver);
    const visibleIds = next
      .filter((it) => visibleSet.has(it.col.id))
      .map((it) => it.col.id);
    writeViewCfg({ visibleColumnIds: visibleIds, hiddenColumnIds: undefined });
    setDragFrom(null);
    setDragOver(null);
  };

  const toggle = () => {
    if (open) {
      setOpenColumnMenu(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 240;
      const left = Math.min(rect.right - width, window.innerWidth - width - 8);
      const top = rect.bottom + 4;
      setCoords({ top, left: Math.max(8, left) });
    }
    setOpenColumnMenu(menuKey);
  };

  const ITEM_LIMITS = [10, 30, 50, 100] as const;

  const Btn = (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      title="표시 설정"
      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Settings2 size={14} />
    </button>
  );

  return (
    <>
      {asTh ? (
        // sticky thead에서 본문이 비치지 않도록 bg 명시.
        <th className="w-8 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950">
          {Btn}
        </th>
      ) : (
        Btn
      )}
      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 240 }}
            className="z-[320] max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => {
              // 팝업 클릭이 에디터/뒤쪽 레이어로 전파되어 선택되는 현상 방지
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {/* 항목 표시 섹션 */}
            <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
              <div className="px-1 py-1 text-xs uppercase tracking-wide text-zinc-500">
                항목
              </div>
              {layout === "fullPage" ? (
                <div className="flex items-center gap-1 px-1 py-1">
                  <span className="text-zinc-400">전체 표시 (고정)</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1 px-1 py-1">
                  {ITEM_LIMITS.map((val) => {
                    const active = (panelState.itemLimit ?? 30) === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onMouseDown={(e) => {
                          // 일부 브라우저에서 클릭 시작 이벤트가 뒤쪽에 전달되는 케이스 차단
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={() => setPanelState({ itemLimit: val })}
                        className={[
                          "rounded border px-2 py-0.5 text-sm font-medium",
                          active
                            ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500 dark:text-white"
                            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800",
                        ].join(" ")}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 속성 표시 카테고리 */}
            <div className="px-1 py-1 text-xs uppercase tracking-wide text-zinc-500">
              속성 표시/순서
            </div>
            {items.map((it, idx) => {
              const isTitle = it.col.type === "title";
              const isDropTarget =
                dragFrom != null && dragOver === idx && dragFrom !== idx;
              return (
                <div
                  key={it.col.id}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = "move";
                    setDragFrom(idx);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDrop();
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={[
                    "flex items-center gap-1 rounded px-1 py-1",
                    isDropTarget ? "border-t-2 border-t-blue-500" : "",
                    it.visible ? "" : "opacity-60",
                  ].join(" ")}
                >
                  <GripVertical
                    size={11}
                    className="cursor-grab text-zinc-400 active:cursor-grabbing"
                  />
                  <span className="min-w-0 flex-1 truncate">{it.col.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isTitle) return; // title은 가시성 토글 불가
                      toggleVisible(it.col.id);
                    }}
                    title={
                      isTitle
                        ? "제목 컬럼은 항상 표시됩니다"
                        : it.visible
                          ? "숨기기"
                          : "표시"
                    }
                    className={[
                      "rounded p-0.5",
                      isTitle
                        ? "cursor-default text-zinc-300"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {it.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

function resolveVisibleColumnIds(
  columns: { id: string; type: string }[],
  viewKind: ViewKind,
  cfg: ViewSpecificConfig,
): Set<string> {
  if (cfg.visibleColumnIds) return new Set(cfg.visibleColumnIds);
  if (cfg.hiddenColumnIds) {
    const hidden = new Set(cfg.hiddenColumnIds);
    return new Set(columns.filter((col) => !hidden.has(col.id)).map((col) => col.id));
  }
  if (viewKind === "list") {
    const title = columns.find((col) => col.type === "title");
    return new Set(title ? [title.id] : []);
  }
  return new Set(columns.map((col) => col.id));
}
