import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  X,
  Search,
  ArrowUpDown,
  Funnel,
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
import { DatabaseViewKindToggle } from "./DatabaseViewKindToggle";
import { DatabaseTemplateButton } from "./DatabaseTemplateButton";

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
    if (view !== "table" && panelState.hiddenViewKinds.includes(view)) {
      onViewChange("table");
    }
  }, [onViewChange, panelState.hiddenViewKinds, view]);

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

  const columns = bundle?.columns ?? [];

  // 속성 타입 기반으로 사용 불가 뷰를 자동 숨김
  const hasSelectCol = columns.some((c) => c.type === "select");
  const hasDateCol = columns.some((c) => c.type === "date");
  const autoHiddenViews: ViewKind[] = [
    ...(!hasSelectCol ? (["kanban"] as ViewKind[]) : []),
    ...(!hasDateCol ? (["timeline"] as ViewKind[]) : []),
  ];
  const effectiveHiddenViewKinds = [
    ...(panelState.hiddenViewKinds ?? []),
    ...autoHiddenViews.filter((v) => !(panelState.hiddenViewKinds ?? []).includes(v)),
  ];

  const sortOptions = useMemo(
    () => columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>),
    [columns],
  );

  // 구버전 sortColumnId 마이그레이션.
  const effectiveSortRules: SortRule[] =
    panelState.sortRules && panelState.sortRules.length > 0
      ? panelState.sortRules
      : panelState.sortColumnId
        ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
        : [];

  const addFilter = () => {
    const first = columns[0];
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

  const addSort = () => {
    const used = new Set(effectiveSortRules.map((r) => r.columnId));
    const first = columns.find((c) => !used.has(c.id)) ?? columns[0];
    if (!first) return;
    const next: SortRule[] = [...effectiveSortRules, { columnId: first.id, dir: "asc" }];
    setPanelState({ sortRules: next, sortColumnId: null });
    setRulesExpanded(true);
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
        <div className="flex flex-wrap items-center gap-0.5">
          <DatabaseViewKindToggle
            view={view}
            onViewChange={onViewChange}
            hiddenViewKinds={effectiveHiddenViewKinds}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
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
                // eslint-disable-next-line jsx-a11y/no-autofocus
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
                className="w-36 select-text bg-transparent py-1 text-xs outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            )}
          </div>

          {/* 필터 | 정렬 — 항목 있을 때만 박스+컬러 */}
          <div className={[
            "inline-flex overflow-hidden",
            hasAnyRules ? "rounded-md border border-zinc-300 dark:border-zinc-600" : "",
          ].join(" ")}>
            {/* 필터 버튼 */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addFilter}
              className={[
                "flex items-center gap-1 px-2 py-1 text-xs",
                panelState.filterRules.length > 0
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <Funnel size={12} />
              {panelState.filterRules.length > 0 && (
                <span className="rounded bg-blue-700 px-1 text-[10px] text-white">
                  {panelState.filterRules.length}
                </span>
              )}
            </button>

            {hasAnyRules && <span className="w-px bg-zinc-300 dark:bg-zinc-600" />}

            {/* 정렬 버튼 */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addSort}
              className={[
                "flex items-center gap-1 px-2 py-1 text-xs",
                effectiveSortRules.length > 0
                  ? "bg-orange-500 text-white hover:bg-orange-600"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <ArrowUpDown size={12} />
              {effectiveSortRules.length > 0 && (
                <span className="rounded bg-orange-700 px-1 text-[10px] text-white">
                  {effectiveSortRules.length}
                </span>
              )}
            </button>

            {/* 펼침/접힘 버튼 — 규칙이 있을 때만 표시 */}
            {hasAnyRules && (
              <>
                <span className="w-px bg-zinc-300 dark:bg-zinc-600" />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setRulesExpanded((v) => !v)}
                  title={rulesExpanded ? "규칙 접기" : "규칙 펼치기"}
                  className="flex items-center px-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {rulesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </>
            )}
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
          {/* 필터 박스들 — [요약 버튼] [x] */}
          {panelState.filterRules.map((rule) => {
            const col = columns.find((c) => c.id === rule.columnId);
            const op = FILTER_OPERATORS.find((o) => o.id === rule.operator);
            const hasValue = !["isEmpty", "isNotEmpty"].includes(rule.operator);
            const summary = [
              col?.name ?? "컬럼",
              op?.label,
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
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-white hover:bg-blue-600"
                >
                  <span className="max-w-[160px] truncate">{summary}</span>
                  <ChevronDown size={10} className="shrink-0 text-blue-200" />
                </button>
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  className="border-l border-blue-400 px-1 py-0.5 text-blue-100 hover:bg-blue-600"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}

          {/* 필터·정렬 구분선 */}
          {panelState.filterRules.length > 0 && effectiveSortRules.length > 0 && (
            <span className="select-none px-0.5 text-zinc-300 dark:text-zinc-600">|</span>
          )}

          {/* 정렬 박스들 — [요약 버튼] [x] */}
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
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-white hover:bg-orange-600"
                >
                  <span className="max-w-[120px] truncate">{summary}</span>
                  <ChevronDown size={10} className="shrink-0 text-orange-200" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSortRule(idx)}
                  className="border-l border-orange-400 px-1 py-0.5 text-orange-100 hover:bg-orange-600"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 규칙 팝오버 — 필터 */}
      {openFilterRule && ruleCoords &&
        createPortal(
          <div
            ref={rulePopoverRef}
            style={{ position: "fixed", top: ruleCoords.top, left: ruleCoords.left, width: 220 }}
            className="z-50 space-y-2 rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-zinc-400">컬럼</div>
              <select
                value={openFilterRule.columnId}
                onChange={(e) => updateRule(openFilterRule.id, { columnId: e.target.value })}
                className="w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              >
                {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-zinc-400">조건</div>
              <select
                value={openFilterRule.operator}
                onChange={(e) => updateRule(openFilterRule.id, { operator: e.target.value as FilterOperator })}
                className="w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              >
                {FILTER_OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            {!["isEmpty", "isNotEmpty"].includes(openFilterRule.operator) && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-zinc-400">값</div>
                <input
                  value={openFilterRule.value ?? ""}
                  onChange={(e) => updateRule(openFilterRule.id, { value: e.target.value })}
                  placeholder="값 입력…"
                  className="w-full select-text rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800"
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
            className="z-50 space-y-2 rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-zinc-400">컬럼</div>
              <select
                value={openSortRule.columnId}
                onChange={(e) => updateSortRule(openSortIdx, { columnId: e.target.value })}
                className="w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              >
                {sortOptions}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-zinc-400">방향</div>
              <button
                type="button"
                onClick={() => updateSortRule(openSortIdx, { dir: openSortRule.dir === "asc" ? "desc" : "asc" })}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-left text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
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
