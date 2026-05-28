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
import { FILTER_OPERATORS, cellToSearchString } from "../../lib/databaseQuery";
import type {
  CellValue,
  ColumnDef,
  DatabasePanelState,
  FilterPreset,
  FilterRule,
  FilterOperator,
  SortRule,
  ViewKind,
} from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { effectiveOptions } from "../../lib/database/columnSource";
import { DatabaseColumnSettingsButton } from "./DatabaseColumnSettingsButton";
import { DatabaseTemplateButton } from "./DatabaseTemplateButton";
import { AppSelect } from "../common/AppSelect";
import { VIEW_ICONS, VIEW_LABELS, getUnavailableViewKinds } from "./databaseBlockViewConstants";
import { IconPicker } from "../common/IconPicker";
import { PageIconDisplay } from "../common/PageIconDisplay";

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
  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(
    panelState.searchQuery.trim().length > 0,
  );
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuHover, setViewMenuHover] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);

  // 프리셋 탭 인라인 이름 편집
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const presetInputRef = useRef<HTMLInputElement>(null);

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

  // 구버전 sortColumnId 마이그레이션 (전역 규칙에만 적용)
  const globalSortRules: SortRule[] =
    panelState.sortRules && panelState.sortRules.length > 0
      ? panelState.sortRules
      : panelState.sortColumnId
        ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
        : [];

  // 활성 프리셋 — activePresetId가 있으면 해당 프리셋의 규칙 사용
  const activePreset: FilterPreset | null =
    (panelState.filterPresets ?? []).find((p) => p.id === panelState.activePresetId) ?? null;

  const activeFilterRules: FilterRule[] = activePreset?.filterRules ?? panelState.filterRules;
  const activeSortRules: SortRule[] = activePreset?.sortRules ?? globalSortRules;

  /** 필터 규칙 업데이트 — 프리셋이 활성화된 경우 프리셋 안에서 업데이트 */
  const setActiveFilterRules = (rules: FilterRule[]) => {
    if (activePreset) {
      const presets = (panelState.filterPresets ?? []).map((p) =>
        p.id === activePreset.id ? { ...p, filterRules: rules } : p,
      );
      setPanelState({ filterPresets: presets });
    } else {
      setPanelState({ filterRules: rules });
    }
  };

  /** 정렬 규칙 업데이트 — 프리셋이 활성화된 경우 프리셋 안에서 업데이트 */
  const setActiveSortRules = (rules: SortRule[]) => {
    if (activePreset) {
      const presets = (panelState.filterPresets ?? []).map((p) =>
        p.id === activePreset.id ? { ...p, sortRules: rules } : p,
      );
      setPanelState({ filterPresets: presets });
    } else {
      setPanelState({ sortRules: rules, sortColumnId: null });
    }
  };

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
    setActiveFilterRules([...activeFilterRules, rule]);
    setRulesExpanded(true);
  };

  const toggleFilterRules = () => {
    setOpenRuleKey(null);
    if (activeFilterRules.length === 0) {
      addFilter(firstFilterColumn?.id);
      return;
    }
    setRulesExpanded((v) => !v);
  };

  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    setActiveFilterRules(
      activeFilterRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  const removeRule = (id: string) => {
    setActiveFilterRules(activeFilterRules.filter((r) => r.id !== id));
    if (openRuleKey === id) setOpenRuleKey(null);
  };

  const addSort = (columnId?: string) => {
    const used = new Set(activeSortRules.map((r) => r.columnId));
    const preferred = columnId ? columns.find((c) => c.id === columnId) : null;
    const first =
      preferred && !used.has(preferred.id)
        ? preferred
        : columns.find((c) => !used.has(c.id)) ?? columns[0];
    if (!first) return;
    setActiveSortRules([...activeSortRules, { columnId: first.id, dir: "asc" }]);
    setRulesExpanded(true);
  };

  const toggleSortRules = () => {
    setOpenRuleKey(null);
    if (activeSortRules.length === 0) {
      addSort(firstSortColumn?.id);
      return;
    }
    setRulesExpanded((v) => !v);
  };

  const updateSortRule = (idx: number, patch: Partial<SortRule>) => {
    const next = activeSortRules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setActiveSortRules(next);
  };

  const removeSortRule = (idx: number) => {
    const next = activeSortRules.filter((_, i) => i !== idx);
    setActiveSortRules(next);
    const key = `sort:${idx}`;
    if (openRuleKey === key) setOpenRuleKey(null);
  };

  const hasAnyRules = activeFilterRules.length > 0 || activeSortRules.length > 0;

  // 현재 열린 필터 규칙
  const openFilterRule = activeFilterRules.find((r) => r.id === openRuleKey) ?? null;
  const openFilterColumn = openFilterRule
    ? columns.find((column) => column.id === openFilterRule.columnId) ?? null
    : null;
  const filterValueOptions = useMemo(() => {
    if (!openFilterColumn || !bundle) return [];
    if (["select", "multiSelect", "status"].includes(openFilterColumn.type)) {
      return effectiveOptions(openFilterColumn, databases, {
        organizations,
        teams,
        projects,
      })
        .filter((option) => !option.divider)
        .map((option) => ({ value: option.id, label: option.label }));
    }
    const seen = new Set<string>();
    const values: Array<{ value: string; label: string }> = [];
    for (const rowPageId of bundle.rowPageOrder) {
      const page = pages[rowPageId];
      if (!page) continue;
      const raw: CellValue =
        openFilterColumn.type === "title"
          ? page.title
          : (page.dbCells?.[openFilterColumn.id] as CellValue | undefined) ?? null;
      const display = cellToSearchString(raw, columns, openFilterColumn.id).trim();
      if (!display || seen.has(display)) continue;
      seen.add(display);
      values.push({ value: display, label: display });
      if (values.length >= 100) break;
    }
    return values;
  }, [bundle, columns, databases, openFilterColumn, organizations, pages, projects, teams]);
  const filterRuleValueLabel = (rule: FilterRule, column: ColumnDef | undefined): string => {
    const value = rule.value ?? "";
    if (!value || !column) return value;
    if (["select", "multiSelect", "status"].includes(column.type)) {
      return (
        effectiveOptions(column, databases, { organizations, teams, projects }).find(
          (option) => option.id === value,
        )?.label ?? value
      );
    }
    return value;
  };
  // 현재 열린 정렬 규칙 idx
  const openSortIdx = openRuleKey?.startsWith("sort:")
    ? parseInt(openRuleKey.slice(5), 10)
    : -1;
  const openSortRule = openSortIdx >= 0 ? (activeSortRules[openSortIdx] ?? null) : null;

  // ── 프리셋 탭 조작 ──────────────────────────────────────────────────────────

  const addPreset = () => {
    const presets = panelState.filterPresets ?? [];
    const lastPreset = presets[presets.length - 1];
    const newPreset: FilterPreset = {
      id: newId(),
      name: `탭 ${presets.length + 1}`,
      filterRules: lastPreset ? [...lastPreset.filterRules] : [],
      sortRules: lastPreset ? [...lastPreset.sortRules] : [],
    };
    setPanelState({
      filterPresets: [...presets, newPreset],
      activePresetId: newPreset.id,
    });
  };

  const deletePreset = (id: string) => {
    const presets = (panelState.filterPresets ?? []).filter((p) => p.id !== id);
    const nextActiveId =
      panelState.activePresetId === id
        ? (presets[presets.length - 1]?.id ?? null)
        : panelState.activePresetId;
    setPanelState({ filterPresets: presets, activePresetId: nextActiveId });
  };

  const commitPresetRename = (id: string) => {
    const name = presetNameDraft.trim();
    if (name) {
      const presets = (panelState.filterPresets ?? []).map((p) =>
        p.id === id ? { ...p, name } : p,
      );
      setPanelState({ filterPresets: presets });
    }
    setEditingPresetId(null);
  };

  const setPresetIcon = (id: string, icon: string | null) => {
    const presets = (panelState.filterPresets ?? []).map((p) =>
      p.id === id ? { ...p, icon: icon ?? undefined } : p,
    );
    setPanelState({ filterPresets: presets });
  };

  const filterPresets = panelState.filterPresets ?? [];

  return (
    <div className="select-none border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
      {/* 툴바 메인 행 */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          ref={viewMenuRef}
          className="relative w-24"
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
            <div className="absolute left-0 top-full z-[720] mt-1 w-24 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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

        {/* 필터 프리셋 탭 */}
        {filterPresets.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {filterPresets.map((preset) => {
              const isActive = panelState.activePresetId === preset.id;
              const isEditing = editingPresetId === preset.id;
              return (
                <div
                  key={preset.id}
                  className={[
                    "group relative flex max-w-[120px] items-center gap-0 rounded-md border text-xs transition-colors",
                    isActive
                      ? "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                  ].join(" ")}
                >
                  {isEditing ? (
                    <>
                      <span className="shrink-0 pl-1">
                        <IconPicker
                          current={preset.icon ?? null}
                          defaultIcon={null}
                          size="sm"
                          onChange={(icon) => setPresetIcon(preset.id, icon)}
                        />
                      </span>
                      <input
                        ref={presetInputRef}
                        autoFocus
                        value={presetNameDraft}
                        onChange={(e) => setPresetNameDraft(e.target.value)}
                        onBlur={() => commitPresetRename(preset.id)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") commitPresetRename(preset.id);
                          if (e.key === "Escape") setEditingPresetId(null);
                        }}
                        className="w-16 bg-transparent py-1 text-xs outline-none"
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setPanelState({
                          activePresetId: isActive ? null : preset.id,
                        })
                      }
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        setPresetNameDraft(preset.name);
                        setEditingPresetId(preset.id);
                      }}
                      className="flex min-w-0 items-center gap-0.5 overflow-hidden py-1 pl-1 pr-2 text-left"
                    >
                      <PageIconDisplay
                        icon={preset.icon ?? null}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="block max-w-[82px] truncate">{preset.name}</span>
                    </button>
                  )}

                  {/* 탭 삭제 — hover 시 표시 */}
                  <button
                    type="button"
                    onClick={() => deletePreset(preset.id)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-white/95 p-0.5 opacity-0 shadow-sm ring-1 ring-zinc-200 hover:bg-zinc-200 group-hover:opacity-100 dark:bg-zinc-900/95 dark:ring-zinc-700 dark:hover:bg-zinc-700"
                    title="탭 삭제"
                  >
                    <X size={9} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 새 프리셋 탭 추가 */}
        <button
          type="button"
          onClick={addPreset}
          title="필터 프리셋 탭 추가"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <Plus size={12} />
        </button>

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
              aria-pressed={activeFilterRules.length > 0}
              className={[
                "relative inline-flex h-7 w-7 items-center justify-center rounded-md",
                activeFilterRules.length > 0
                  ? "text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <Funnel size={13} />
              {activeFilterRules.length > 0 ? (
                <span className="pointer-events-none absolute bottom-[1px] right-[1px] min-w-[10px] rounded-full bg-blue-600 px-[2px] text-center text-[9px] font-semibold leading-[10px] text-white dark:bg-blue-500">
                  {activeFilterRules.length > 99 ? "99+" : activeFilterRules.length}
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
              aria-pressed={activeSortRules.length > 0}
              className={[
                "relative inline-flex h-7 w-7 items-center justify-center rounded-md",
                activeSortRules.length > 0
                  ? "text-orange-600 hover:bg-zinc-100 dark:text-orange-400 dark:hover:bg-zinc-800"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <ArrowUpDown size={13} />
              {activeSortRules.length > 0 ? (
                <span className="pointer-events-none absolute bottom-[1px] right-[1px] min-w-[10px] rounded-full bg-orange-600 px-[2px] text-center text-[9px] font-semibold leading-[10px] text-white dark:bg-orange-500">
                  {activeSortRules.length > 99 ? "99+" : activeSortRules.length}
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
          {activeFilterRules.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {activeFilterRules.map((rule) => {
                const col = columns.find((c) => c.id === rule.columnId);
                const hasValue = !["isEmpty", "isNotEmpty"].includes(rule.operator);
                const valueLabel = filterRuleValueLabel(rule, col);
                const summary = hasValue && valueLabel ? valueLabel : (col?.name ?? "필터");
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

          {activeFilterRules.length > 0 && activeSortRules.length > 0 && (
            <span className="select-none px-0.5 text-zinc-300 dark:text-zinc-600">|</span>
          )}

          {activeSortRules.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {activeSortRules.map((rule, idx) => {
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
                <FilterValueControl
                  rule={openFilterRule}
                  options={filterValueOptions}
                  onChange={(value) => updateRule(openFilterRule.id, { value })}
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

function FilterValueControl({
  rule,
  options,
  onChange,
}: {
  rule: FilterRule;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(rule.value ?? "");
  const composingRef = useRef(false);
  const selectedOption = options.find((option) => option.value === (rule.value ?? ""));
  const [directInputOpen, setDirectInputOpen] = useState(!selectedOption);

  useEffect(() => {
    if (!composingRef.current) setDraft(rule.value ?? "");
    setDirectInputOpen(!selectedOption);
  }, [rule.value, selectedOption]);

  const commit = (value: string) => {
    onChange(value);
  };

  return (
    <div className="space-y-1">
      {options.length > 0 && (
        <AppSelect
          value={selectedOption ? (rule.value ?? "") : ""}
          onChange={(value) => {
            if (!value) {
              setDirectInputOpen(true);
              setDraft("");
              commit("");
              return;
            }
            setDirectInputOpen(false);
            setDraft(value);
            commit(value);
          }}
          options={[{ value: "", label: "직접 입력" }, ...options]}
          buttonClassName="w-full px-1.5 py-1"
          menuClassName="max-h-64 overflow-y-auto"
        />
      )}
      {(options.length === 0 || directInputOpen) && (
        <input
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            if (!composingRef.current) commit(value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const value = event.currentTarget.value;
            setDraft(value);
            commit(value);
          }}
          onBlur={() => commit(draft)}
          placeholder={options.length > 0 ? "직접 입력…" : "값 입력…"}
          className="w-full select-text rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800"
        />
      )}
    </div>
  );
}
