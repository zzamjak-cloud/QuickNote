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

type Props = {
  databaseId: string;
  viewKind: ViewKind;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 헤더 안에 표 컬럼으로 둘 때(<th>) true. */
  asTh?: boolean;
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

  const Btn = (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      title="속성 표시 설정"
      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Settings2 size={14} />
    </button>
  );

  return (
    <>
      {asTh ? (
        <th className="w-8 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
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
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">
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
