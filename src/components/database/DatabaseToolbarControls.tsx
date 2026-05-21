import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  X,
  Search,
  ArrowUpDown,
  Funnel,
  Plus,
} from "lucide-react";
import { newId } from "../../lib/id";
import { FILTER_OPERATORS } from "../../lib/databaseQuery";
import type {
  DatabasePanelState,
  FilterRule,
  FilterOperator,
  SortRule,
  ViewKind,
} from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { DatabaseColumnSettingsButton } from "./DatabaseColumnSettingsButton";
import { DatabaseTemplateButton } from "./DatabaseTemplateButton";
import { AppSelect } from "../common/AppSelect";
import { VIEW_ICONS, VIEW_LABELS, getUnavailableViewKinds } from "./databaseBlockViewConstants";

type Props = {
  databaseId: string;
  viewKind: ViewKind;
  view: ViewKind;
  onViewChange: (v: ViewKind) => void;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 인라인/전체페이지 레이아웃 구분 — 설정 팝업 항목 표시 섹션에서 사용. */
  layout?: "inline" | "fullPage";
};

export function DatabaseToolbarControls({
  databaseId,
  viewKind,
  view,
  onViewChange,
  panelState,
  setPanelState,
  layout,
}: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(
    panelState.searchQuery.trim().length > 0,
  );
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuHover, setViewMenuHover] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);

  // 검색창 — 한글 IME 입력 깨짐 방지: composition 동안 panelState commit 보류.
  const [searchDraft, setSearchDraft] = useState(panelState.searchQuery);
  const composingRef = useRef(false);
  useEffect(() => {
    if (!composingRef.current) setSearchDraft(panelState.searchQuery);
  }, [panelState.searchQuery]);
  useEffect(() => {
    if (panelState.searchQuery.trim().length > 0) setSearchOpen(true);
  }, [panelState.searchQuery]);
  useEffect(() => {
    if (!bundle) return;
    const unavailable = new Set<ViewKind>(getUnavailableViewKinds(bundle.columns));
    const visibleViews = (Object.keys(VIEW_LABELS) as ViewKind[]).filter(
      (kind) => !unavailable.has(kind),
    );
    const nextView = visibleViews[0];
    if (!nextView) return;
    if (!visibleViews.includes(view)) {
      onViewChange(nextView);
    }
  }, [bundle, onViewChange, panelState.hiddenViewKinds, view]);

  // 규칙 팝오버 — 한 번에 하나만 열림.
  const [openRuleKey, setOpenRuleKey] = useState<string | null>(null);
  const [ruleCoords, setRuleCoords] = useState<{ top: number; left: number } | null>(null);
  const rulePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openRuleKey) return;
    const handler = (e: MouseEvent) => {
      if (rulePopoverRef.current?.contains(e.target as Node)) return;
      setOpenRuleKey(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [openRuleKey]);

  const openPopover = (key: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 220 - 8);
    setRuleCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
    setOpenRuleKey((prev) => (prev === key ? null : key));
  };

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (viewMenuRef.current?.contains(event.target as Node)) return;
      setViewMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewMenuOpen]);

  const columns = useMemo(() => bundle?.columns ?? [], [bundle?.columns]);

  // 속성 타입 기반으로 사용 불가 뷰를 드롭다운 목록에서 제외
  const autoHiddenViews = getUnavailableViewKinds(columns);
  const availableViewOptions = (Object.keys(VIEW_LABELS) as ViewKind[])
    .filter((kind) => !autoHiddenViews.includes(kind))
    .map((kind) => ({ value: kind, label: VIEW_LABELS[kind] }));
  const currentViewOption = availableViewOptions.find((option) => option.value === view) ?? availableViewOptions[0];
  const CurrentViewIcon = currentViewOption ? VIEW_ICONS[currentViewOption.value] : null;

  const sortOptions = useMemo(
    () => columns.map((column) => ({ value: column.id, label: column.name })),
    [columns],
  );

  // 구버전 sortColumnId 마이그레이션.
  const effectiveSortRules: SortRule[] =
    panelState.sortRules && panelState.sortRules.length > 0
      ? panelState.sortRules
      : panelState.sortColumnId
        ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
        : [];

  const firstFilterColumn = useMemo(
    () => columns.find((column) => column.type === "title") ?? columns[0],
    [columns],
  );
  const firstSortColumn = firstFilterColumn;

  const addFilter = (columnId = firstFilterColumn?.id) => {
    const first = columns.find((column) => column.id === columnId);
    if (!first) return;
    const rule: FilterRule = {
      id: newId(),
      columnId: first.id,
      operator: "contains",
      value: "",
    };
    setPanelState({ filterRules: [...panelState.filterRules, rule] });
    setRulesExpanded(true);
  };

  const toggleFilterRules = () => {
    setOpenRuleKey(null);
    if (panelState.filterRules.length === 0) {
      addFilter(firstFilterColumn?.id);
      return;
    }
    setRulesExpanded((v) => !v);
  };

  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    setPanelState({
      filterRules: panelState.filterRules.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  };

  const removeRule = (id: string) => {
    setPanelState({
      filterRules: panelState.filterRules.filter((r) => r.id !== id),
    });
    if (openRuleKey === id) setOpenRuleKey(null);
  };

  const addSort = (columnId?: string) => {
    const used = new Set(effectiveSortRules.map((r) => r.columnId));
    const preferred = columnId ? columns.find((c) => c.id === columnId) : null;
    const first =
      preferred && !used.has(preferred.id)
        ? preferred
        : columns.find((c) => !used.has(c.id)) ?? columns[0];
    if (!first) return;
    const next: SortRule[] = [...effectiveSortRules, { columnId: first.id, dir: "asc" }];
    setPanelState({ sortRules: next, sortColumnId: null });
    setRulesExpanded(true);
  };

  const toggleSortRules = () => {
    setOpenRuleKey(null);
    if (effectiveSortRules.length === 0) {
      addSort(firstSortColumn?.id);
      return;
    }
    setRulesExpanded((v) => !v);
  };

  const updateSortRule = (idx: number, patch: Partial<SortRule>) => {
    const next = effectiveSortRules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setPanelState({ sortRules: next, sortColumnId: null });
  };

  const removeSortRule = (idx: number) => {
    const next = effectiveSortRules.filter((_, i) => i !== idx);
    setPanelState({ sortRules: next, sortColumnId: null });
    const key = `sort:${idx}`;
    if (openRuleKey === key) setOpenRuleKey(null);
  };

  const hasAnyRules =
    panelState.filterRules.length > 0 || effectiveSortRules.length > 0;

  // 현재 열린 필터 규칙
  const openFilterRule = panelState.filterRules.find((r) => r.id === openRuleKey) ?? null;
  // 현재 열린 정렬 규칙 idx
  const openSortIdx = openRuleKey?.startsWith("sort:")
    ? parseInt(openRuleKey.slice(5), 10)
    : -1;
  const openSortRule = openSortIdx >= 0 ? (effectiveSortRules[openSortIdx] ?? null) : null;

  return (
    <div className="select-none border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
      {/* 툴바 메인 행 */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          ref={viewMenuRef}
          className="relative w-32"
          onMouseEnter={() => setViewMenuHover(true)}
          onMouseLeave={() => {
            if (viewMenuOpen) return;
            setViewMenuHover(false);
          }}
        >
          {viewMenuHover || viewMenuOpen ? (
            <button
              type="button"
              aria-label="데이터베이스 보기 모드"
              onClick={() => setViewMenuOpen((prev) => !prev)}
              className="flex h-8 w-full items-center justify-between gap-2 rounded border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {CurrentViewIcon ? <CurrentViewIcon size={14} className="shrink-0" /> : null}
                <span className="truncate">{currentViewOption?.label ?? "모드"}</span>
              </span>
              <ChevronDown size={14} className={viewMenuOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          ) : (
            <div className="flex h-8 items-center gap-1.5 px-2 text-sm text-zinc-700 dark:text-zinc-200">
              {CurrentViewIcon ? <CurrentViewIcon size={14} className="shrink-0" /> : null}
              <span className="truncate">{currentViewOption?.label ?? "모드"}</span>
            </div>
          )}
          {viewMenuOpen && (
            <div className="absolute left-0 top-full z-[720] mt-1 w-32 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              {availableViewOptions.map((option) => {
                const OptionIcon = VIEW_ICONS[option.value];
                const selected = option.value === view;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { onViewChange(option.value); setViewMenuOpen(false); }}
                    className={[
                      "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left",
                      selected
                        ? "bg-blue-600 font-semibold text-white"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    <OptionIcon size={14} className="shrink-0" />
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {/* 갤러리 열 수 선택 */}
          {view === "gallery" && (
            <AppSelect
              value={String(panelState.galleryColumns ?? 4)}
              options={[
                { value: "2", label: "2열" },
                { value: "3", label: "3열" },
                { value: "4", label: "4열" },
                { value: "5", label: "5열" },
                { value: "6", label: "6열" },
              ]}
              onChange={(v) => setPanelState({ galleryColumns: Number(v) })}
              className="h-7 text-xs"
            />
          )}
          {/* 검색 — 활성 시 슬라이드 펼침 */}
          <div className={[
            "inline-flex items-center gap-1 transition-all",
            searchOpen ? "rounded-md border border-zinc-300 bg-white px-1.5 dark:border-zinc-600 dark:bg-zinc-900" : "",
          ].join(" ")}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (searchOpen && searchDraft.length > 0) {
                  setSearchDraft("");
                  setPanelState({ searchQuery: "" });
                }
                setSearchOpen((v) => !v);
              }}
              title={searchOpen ? "검색 닫기" : "검색 열기"}
              className="inline-flex h-7 w-7 items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              <Search size={13} />
            </button>
            {searchOpen && (
              <input
                autoFocus
                type="search"
                placeholder="검색…"
                value={searchDraft}
                onChange={(e) => {
                  setSearchDraft(e.target.value);
                  if (!composingRef.current) {
                    setPanelState({ searchQuery: e.target.value });
                  }
                }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={(e) => {
                  composingRef.current = false;
                  setPanelState({ searchQuery: (e.target as HTMLInputElement).value });
                }}
                onBlur={() => {
                  // 비어있으면 접힘
                  if (!searchDraft.trim()) setSearchOpen(false);
                }}
                className="w-36 select-text bg-transparent py-1 text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            )}
          </div>

          {/* 필터 | 정렬 — 아이콘 단독 토글 */}
          <div className="inline-flex items-center gap-0.5">
            {/* 필터 버튼 */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleFilterRules}
              title="필터"
              aria-label="필터"
              aria-pressed={panelState.filterRules.length > 0}
              className={[
                "relative inline-flex h-7 w-7 items-center justify-center rounded-md",
                panelState.filterRules.length > 0
                  ? "text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <Funnel size={13} />
              {panelState.filterRules.length > 0 ? (
                <span className="pointer-events-none absolute bottom-[1px] right-[1px] min-w-[10px] rounded-full bg-blue-600 px-[2px] text-center text-[9px] font-semibold leading-[10px] text-white dark:bg-blue-500">
                  {panelState.filterRules.length > 99 ? "99+" : panelState.filterRules.length}
                </span>
              ) : null}
            </button>

            {/* 정렬 버튼 */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleSortRules}
              title="정렬"
              aria-label="정렬"
              aria-pressed={effectiveSortRules.length > 0}
              className={[
                "relative inline-flex h-7 w-7 items-center justify-center rounded-md",
                effectiveSortRules.length > 0
                  ? "text-orange-600 hover:bg-zinc-100 dark:text-orange-400 dark:hover:bg-zinc-800"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <ArrowUpDown size={13} />
              {effectiveSortRules.length > 0 ? (
                <span className="pointer-events-none absolute bottom-[1px] right-[1px] min-w-[10px] rounded-full bg-orange-600 px-[2px] text-center text-[9px] font-semibold leading-[10px] text-white dark:bg-orange-500">
                  {effectiveSortRules.length > 99 ? "99+" : effectiveSortRules.length}
                </span>
              ) : null}
            </button>
          </div>

          {/* 표시 설정 버튼 */}
          <DatabaseColumnSettingsButton
            databaseId={databaseId}
            viewKind={viewKind}
            panelState={panelState}
            setPanelState={setPanelState}
            layout={layout}
          />

          {/* 템플릿 버튼 */}
          <DatabaseTemplateButton databaseId={databaseId} />
        </div>
      </div>

      {/* 필터·정렬 규칙 인라인 펼침 영역 */}
      {rulesExpanded && hasAnyRules && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {panelState.filterRules.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {panelState.filterRules.map((rule) => {
                const col = columns.find((c) => c.id === rule.columnId);
                const op = FILTER_OPERATORS.find((o) => o.id === rule.operator);
                const hasValue = !["isEmpty", "isNotEmpty"].includes(rule.operator);
                const summary = [
                  `${col?.name ?? "컬럼"}${op?.label ?? ""}`,
                  hasValue && rule.value ? `"${rule.value}"` : undefined,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={rule.id}
                    className="flex items-center gap-0 overflow-hidden rounded bg-blue-500"
                  >
                    <button
                      type="button"
                      onClick={(e) => openPopover(rule.id, e.currentTarget)}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-white hover:bg-blue-600"
                    >
                      <span className="max-w-[160px] truncate">{summary}</span>
                      <ChevronDown size={10} className="shrink-0 text-blue-200" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.id)}
                      className="border-l border-blue-400 px-1 py-0.5 text-blue-100 hover:bg-blue-600"
                      aria-label="필터 제거"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
              {firstFilterColumn && (
                <button
                  type="button"
                  onClick={() => addFilter(firstFilterColumn.id)}
                  title="필터 추가"
                  aria-label="필터 추가"
                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                >
                  <Plus size={11} />
                </button>
              )}
            </div>
          )}

          {panelState.filterRules.length > 0 && effectiveSortRules.length > 0 && (
            <span className="select-none px-0.5 text-zinc-300 dark:text-zinc-600">|</span>
          )}

          {effectiveSortRules.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {effectiveSortRules.map((rule, idx) => {
                const col = columns.find((c) => c.id === rule.columnId);
                const key = `sort:${idx}`;
                const summary = `${col?.name ?? "컬럼"} ${rule.dir === "asc" ? "↑" : "↓"}`;
                return (
                  <div
                    key={`${rule.columnId}:${idx}`}
                    className="flex items-center gap-0 overflow-hidden rounded bg-orange-500"
                  >
                    <button
                      type="button"
                      onClick={(e) => openPopover(key, e.currentTarget)}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-white hover:bg-orange-600"
                    >
                      <span className="max-w-[120px] truncate">{summary}</span>
                      <ChevronDown size={10} className="shrink-0 text-orange-200" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSortRule(idx)}
                      className="border-l border-orange-400 px-1 py-0.5 text-orange-100 hover:bg-orange-600"
                      aria-label="정렬 제거"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
              {firstSortColumn && (
                <button
                  type="button"
                  onClick={() => addSort(firstSortColumn.id)}
                  title="정렬 추가"
                  aria-label="정렬 추가"
                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-900/40"
                >
                  <Plus size={11} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 규칙 팝오버 — 필터 */}
      {openFilterRule && ruleCoords &&
        createPortal(
          <div
            ref={rulePopoverRef}
            style={{ position: "fixed", top: ruleCoords.top, left: ruleCoords.left, width: 220 }}
            className="z-50 space-y-2 rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-zinc-400">컬럼</div>
              <AppSelect
                value={openFilterRule.columnId}
                onChange={(nextValue) => updateRule(openFilterRule.id, { columnId: nextValue })}
                options={columns.map((column) => ({ value: column.id, label: column.name }))}
                buttonClassName="w-full px-1.5 py-1"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-zinc-400">조건</div>
              <AppSelect
                value={openFilterRule.operator}
                onChange={(nextValue) => updateRule(openFilterRule.id, { operator: nextValue as FilterOperator })}
                options={FILTER_OPERATORS.map((operator) => ({ value: operator.id, label: operator.label }))}
                buttonClassName="w-full px-1.5 py-1"
              />
            </div>
            {!["isEmpty", "isNotEmpty"].includes(openFilterRule.operator) && (
              <div className="space-y-1">
                <div className="text-[11px] uppercase text-zinc-400">값</div>
                <input
                  value={openFilterRule.value ?? ""}
                  onChange={(e) => updateRule(openFilterRule.id, { value: e.target.value })}
                  placeholder="값 입력…"
                  className="w-full select-text rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800"
                />
              </div>
            )}
          </div>,
          document.body,
        )}

      {/* 규칙 팝오버 — 정렬 */}
      {openSortRule && ruleCoords &&
        createPortal(
          <div
            ref={rulePopoverRef}
            style={{ position: "fixed", top: ruleCoords.top, left: ruleCoords.left, width: 200 }}
            className="z-50 space-y-2 rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-zinc-400">컬럼</div>
              <AppSelect
                value={openSortRule.columnId}
                onChange={(nextValue) => updateSortRule(openSortIdx, { columnId: nextValue })}
                options={sortOptions}
                buttonClassName="w-full px-1.5 py-1"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-zinc-400">방향</div>
              <button
                type="button"
                onClick={() => updateSortRule(openSortIdx, { dir: openSortRule.dir === "asc" ? "desc" : "asc" })}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-left text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                {openSortRule.dir === "asc" ? "↑ 오름차순" : "↓ 내림차순"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
