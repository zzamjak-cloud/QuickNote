import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import type {
  DatabasePanelState,
  ViewKind,
  ViewSpecificConfig,
} from "../../types/database";
import {
  buildViewColumnConfig,
  isInternalHiddenColumnId,
  resolveViewColumnOrderState,
  setColumnVisibleInViewConfig,
} from "../../types/database";
import { getGroupableColumns } from "../../lib/database/grouping";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { AppSelect } from "../common/AppSelect";
import { CALLOUT_PRESETS } from "../../lib/tiptapExtensions/calloutPresets";

type Props = {
  databaseId: string;
  viewKind: ViewKind;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 헤더 안에 표 컬럼으로 둘 때(<th>) true. */
  asTh?: boolean;
  /** 인라인/전체페이지 레이아웃 구분 — 항목 표시 섹션에서 사용. */
  layout?: "inline" | "fullPage";
  /**
   * 팝오버 z-index Tailwind 클래스. 기본 z-[320].
   * LC 스케줄러처럼 z-[500] 모달 내부에서 띄울 때는 그 위 값을 넘겨 뒤로 숨지 않게 한다.
   */
  popoverZClassName?: string;
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
  popoverZClassName = "z-[320]",
}: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  const openColumnMenuId = useUiStore((s) => s.openColumnMenuId);
  const setOpenColumnMenu = useUiStore((s) => s.setOpenColumnMenu);
  // 같은 원본 DB를 가리키는 인라인 DB 블록이 한 페이지에 여러 개일 때,
  // databaseId+viewKind 만으로는 menuKey 가 겹쳐 두 블록의 팝업이 동시에 열린다.
  // useId() 로 블록 인스턴스마다 고유 키를 부여해 클릭한 블록의 팝업만 열리게 한다.
  const instanceId = useId();
  const menuKey = `settings:${databaseId}:${viewKind}:${instanceId}`;
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
  // 모든 뷰는 동일 규칙을 따른다 — 설정이 없으면 전체 표시가 기본값.
  // (이전엔 list 뷰만 title-only 기본값으로 특수 처리해 설정 패널과 실제 렌더가 어긋났다.)
  const cfgForOrder: ViewSpecificConfig = cfg;
  const columnOrderState = resolveViewColumnOrderState(allCols, viewKind, cfgForOrder);
  const visibleSet = new Set(columnOrderState.visibleColumnIds);
  const columnsById = new Map(allCols.map((column) => [column.id, column]));
  const orderedCols = columnOrderState.orderedColumnIds
    .map((columnId) => columnsById.get(columnId))
    .filter((column): column is typeof allCols[number] => Boolean(column));
  // 표시 설정 리스트는 활성/비활성 여부와 무관하게 현재 뷰의 표시 순서를 따른다.
  // 내부 전용 컬럼(카드 색상·스케줄러 메타)은 목록에서 제외 — 사용자가 표시/숨김을 선택할 수 없다.
  const items: { col: typeof allCols[number]; visible: boolean }[] = orderedCols
    .map((col) => ({
      col,
      visible: visibleSet.has(col.id),
    }))
    .filter((it) => !isInternalHiddenColumnId(it.col.id));

  const writeViewCfg = (patch: Partial<ViewSpecificConfig>) => {
    const nextCfg: ViewSpecificConfig = { ...cfg, ...patch };
    const nextViewConfigs = { ...(panelState.viewConfigs ?? {}), [viewKind]: nextCfg };
    setPanelState({ viewConfigs: nextViewConfigs });
    // 표시설정 컬럼 순서/가시성을 DB 레벨(bundle.panelState)에도 미러링한다.
    // 인라인 DB 블럭은 panelState 를 블럭 attrs 에 저장하므로, DB 단위로 순서를 참조하는
    // 피커뷰 속성 패널이 표시설정 순서를 따르도록 bundle.panelState 에 함께 기록한다.
    patchDatabasePanelState(databaseId, { viewConfigs: nextViewConfigs });
  };

  const toggleVisible = (id: string) => {
    const nextCfg = setColumnVisibleInViewConfig(
      allCols,
      viewKind,
      cfgForOrder,
      id,
      !visibleSet.has(id),
    );
    writeViewCfg(nextCfg);
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
    // 표시 설정의 순서는 뷰별 설정에만 저장한다. 숨김 컬럼은 현재 위치를 유지한다.
    const nextCfg = buildViewColumnConfig(
      allCols,
      viewKind,
      next.map((it) => it.col.id),
      columnOrderState.hiddenColumnIds,
    );
    writeViewCfg(nextCfg);
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
  const pageTreeEnabled = panelState.pageTreeEnabled === true;

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
            className={`${popoverZClassName} max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900`}
            onMouseDown={(e) => {
              // 팝업 클릭이 에디터/뒤쪽 레이어로 전파되어 선택되는 현상 방지
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {/* 헤더 섹션 — 인라인 DB 전용(제목 숨기기·헤더 배경 컬러). */}
            {layout === "inline" && (
              <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
                <div className="px-1 py-1 text-xs uppercase tracking-wide text-zinc-500">
                  헤더
                </div>
                <button
                  type="button"
                  onClick={() => setPanelState({ hideTitle: !panelState.hideTitle })}
                  className="flex w-full items-center justify-between rounded px-1.5 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>제목 숨기기</span>
                  <span
                    className={[
                      "relative h-4 w-7 shrink-0 rounded-full transition",
                      panelState.hideTitle
                        ? "bg-blue-500"
                        : "bg-zinc-300 dark:bg-zinc-600",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                        panelState.hideTitle ? "left-3.5" : "left-0.5",
                      ].join(" ")}
                    />
                  </span>
                </button>
                <div className="px-1 py-1">
                  <div className="mb-1 text-xs text-zinc-500">헤더 컬러</div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* 없음(기본/투명) */}
                    <button
                      type="button"
                      title="없음"
                      onClick={() => setPanelState({ headerColor: null })}
                      className={[
                        "flex h-6 w-6 items-center justify-center rounded border border-zinc-300 bg-white text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800",
                        panelState.headerColor == null ? "ring-2 ring-blue-400" : "",
                      ].join(" ")}
                    >
                      ✕
                    </button>
                    {CALLOUT_PRESETS.filter((p) => p.color).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        title={p.label}
                        onClick={() => setPanelState({ headerColor: p.color })}
                        className={[
                          "h-6 w-6 rounded border border-zinc-300 dark:border-zinc-600",
                          panelState.headerColor === p.color
                            ? "ring-2 ring-blue-400"
                            : "",
                        ].join(" ")}
                        style={{ background: p.color ?? undefined }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 그룹화 섹션 — 칸반은 자체 그룹 컨트롤을 쓰므로 숨김. */}
            {viewKind !== "kanban" && (
              <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
                <div className="px-1 py-1 text-xs uppercase tracking-wide text-zinc-500">
                  그룹화
                </div>
                {(() => {
                  const groupableCols = getGroupableColumns(allCols).filter(
                    (c) => !isInternalHiddenColumnId(c.id),
                  );
                  if (groupableCols.length === 0) {
                    return (
                      <p className="px-1 py-1 text-xs text-zinc-400">
                        사람·상태·선택 속성을 추가하면 그룹화할 수 있습니다.
                      </p>
                    );
                  }
                  return (
                    <div className="px-1 py-1">
                      <AppSelect
                        value={panelState.groupByColumnId ?? ""}
                        onChange={(v) => setPanelState({ groupByColumnId: v || null })}
                        options={[
                          { value: "", label: "그룹화 안 함" },
                          ...groupableCols.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                        buttonClassName="w-full px-1.5 py-1"
                      />
                    </div>
                  );
                })()}
              </div>
            )}
            {/* 항목 표시 섹션 */}
            <div className="mb-1 border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800">
              <div className="px-1 py-1 text-xs uppercase tracking-wide text-zinc-500">
                항목
              </div>
              {(() => {
                // inline/fullPage 통일 — 기본 limit = 100. (DatabaseBlockView 와 동일 규칙)
                const defaultLimit = 100;
                return (
                  <div className="space-y-1 px-1 py-1">
                    <div className="flex flex-wrap gap-1">
                      {ITEM_LIMITS.map((val) => {
                        const active = (panelState.itemLimit ?? defaultLimit) === val;
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
                    <button
                      type="button"
                      role="switch"
                      aria-checked={pageTreeEnabled}
                      title={pageTreeEnabled ? "하위 페이지 트리 끄기" : "하위 페이지 트리 켜기"}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => setPanelState({ pageTreeEnabled: !pageTreeEnabled })}
                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <span className="min-w-0 truncate">하위 페이지 트리 활성화</span>
                      <span
                        className={[
                          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                          pageTreeEnabled ? "bg-blue-600 dark:bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
                            pageTreeEnabled ? "translate-x-3.5" : "translate-x-0.5",
                          ].join(" ")}
                        />
                      </span>
                    </button>
                  </div>
                );
              })()}
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
                    it.visible ? "" : "text-red-600 dark:text-red-400",
                  ].join(" ")}
                >
                  <GripVertical
                    size={11}
                    className={[
                      "cursor-grab active:cursor-grabbing",
                      it.visible ? "text-zinc-400" : "text-red-400 dark:text-red-500",
                    ].join(" ")}
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
