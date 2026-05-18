import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import type {
  DatabasePanelState,
  ViewKind,
  ViewSpecificConfig,
} from "../../types/database";
import { getVisibleOrderedColumns } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import {
  VIEW_ICONS,
  VIEW_LABELS,
  getUnavailableViewKinds,
} from "./databaseBlockViewConstants";

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

  // 현재 가시성·순서를 풀어서 보여주기 위한 작업 리스트.
  // 1) visibleColumnIds가 있으면 그 순서대로 visible.
  // 2) 누락된 컬럼은 hidden으로 끝에 붙임.
  const allCols = bundle.columns;
  const unavailableViews = new Set<ViewKind>(getUnavailableViewKinds(allCols));
  const orderedVisible = getVisibleOrderedColumns(allCols, viewKind, panelState.viewConfigs);
  const visibleSet = new Set(orderedVisible.map((c) => c.id));
  const hiddenCols = allCols.filter((c) => !visibleSet.has(c.id));
  // 표시 항목들의 통합 리스트(보임 → 숨김 순). 드래그 핸들로 재정렬.
  const items: { col: typeof allCols[number]; visible: boolean }[] = [
    ...orderedVisible.map((c) => ({ col: c, visible: true })),
    ...hiddenCols.map((c) => ({ col: c, visible: false })),
  ];

  const writeViewCfg = (patch: Partial<ViewSpecificConfig>) => {
    const nextCfg: ViewSpecificConfig = { ...cfg, ...patch };
    setPanelState({
      viewConfigs: { ...(panelState.viewConfigs ?? {}), [viewKind]: nextCfg },
    });
  };

  const toggleVisible = (id: string) => {
    const visIds = items.filter((it) => it.visible).map((it) => it.col.id);
    const newVis = visIds.includes(id)
      ? visIds.filter((v) => v !== id)
      : [...visIds, id];
    // title 컬럼은 항상 보이도록 보장.
    const titleCol = allCols.find((c) => c.type === "title");
    if (titleCol && !newVis.includes(titleCol.id)) {
      newVis.unshift(titleCol.id);
    }
    writeViewCfg({ visibleColumnIds: newVis, hiddenColumnIds: undefined });
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
    // 드래그 결과 순서를 visibleColumnIds로 직렬화 (보이는 것만 순서 유지, 숨김은 끝).
    const visibleIds = next.filter((it) => it.visible).map((it) => it.col.id);
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
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-base shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
              <div className="px-1 py-1 text-sm uppercase text-zinc-500">
                모드 표시
              </div>
              {(Object.keys(VIEW_ICONS) as ViewKind[]).map((kind) => {
                if (unavailableViews.has(kind)) return null;
                const Icon = VIEW_ICONS[kind];
                const hidden = kind !== "table" && panelState.hiddenViewKinds.includes(kind);
                const disabled = kind === "table" || kind === viewKind;
                const disabledReason =
                  kind === "table"
                    ? "표 모드는 항상 표시됩니다"
                    : kind === viewKind
                      ? "현재 선택 중인 모드는 비활성화할 수 없습니다"
                      : null;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      const current = new Set(panelState.hiddenViewKinds.filter((v) => v !== "table"));
                      if (current.has(kind)) current.delete(kind);
                      else current.add(kind);
                      setPanelState({ hiddenViewKinds: [...current] });
                    }}
                    className={[
                      "flex w-full items-center gap-2 rounded px-1 py-1 text-left",
                      disabled
                        ? "cursor-default text-zinc-400"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                      hidden ? "opacity-55" : "",
                    ].join(" ")}
                    title={disabled ? (disabledReason ?? "") : hidden ? "모드 표시" : "모드 감추기"}
                  >
                    <Icon size={12} />
                    <span className="min-w-0 flex-1 truncate">{VIEW_LABELS[kind]}</span>
                    {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                );
              })}
            </div>
            {/* 항목 표시 섹션 */}
            <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
              <div className="px-1 py-1 text-sm uppercase text-zinc-500">
                항목 표시
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
                        onClick={() => setPanelState({ itemLimit: val })}
                        className={[
                          "rounded border px-2 py-0.5 text-base",
                          active
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
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
            <div className="px-1 py-1 text-sm uppercase text-zinc-500">
              속성 표시 · 순서
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
