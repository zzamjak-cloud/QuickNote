import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Pencil, Plus, Save } from "lucide-react";
import type { CellValue, ColumnType, DatabaseRowPreset } from "../../types/database";
import { useDatabaseStore, defaultColumnForType } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { DatabaseCell } from "./DatabaseCell";
import { DatabaseColumnMenu } from "./DatabaseColumnMenu";
import {
  isLCSchedulerDatabaseId,
  isLCSchedulerHiddenPropertyColumnId,
  LC_SCHEDULER_COLUMN_IDS,
  getLCSchedulerWorkspaceIdFromDatabaseId,
} from "../../lib/scheduler/database";
import { rememberSchedulerPropertyValues } from "../../lib/scheduler/lastPropertyMemory";

const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "json", label: "JSON" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

type PresetScope = "workspace" | "organization" | "team" | "project";

const PROPERTY_HIDDEN_COLUMN_IDS_META_KEY = "propertyHiddenColumnIds";
const PROPERTY_PANEL_META_CELL_ID = "_qn_property_panel_meta";

function scopeLabel(scope: PresetScope): string {
  if (scope === "organization") return "조직";
  if (scope === "team") return "팀";
  if (scope === "project") return "프로젝트";
  return "워크스페이스";
}

function readRowStringCell(cells: Record<string, CellValue> | undefined, columnId: string): string | null {
  const val = cells?.[columnId];
  return typeof val === "string" && val.trim() ? val : null;
}

function hasAssigneeValue(value: CellValue): boolean {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

function readPresetIdFromMeta(metaCell: CellValue): string | null {
  if (!metaCell || typeof metaCell !== "object" || Array.isArray(metaCell)) return null;
  const candidate = (metaCell as Record<string, unknown>).presetId;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readHiddenColumnIdsFromMeta(metaCell: CellValue): string[] | null {
  if (!metaCell || typeof metaCell !== "object" || Array.isArray(metaCell)) return null;
  const record = metaCell as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, PROPERTY_HIDDEN_COLUMN_IDS_META_KEY)) return null;
  const candidate = record[PROPERTY_HIDDEN_COLUMN_IDS_META_KEY];
  if (!Array.isArray(candidate)) return [];
  return candidate
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function scopeColumnId(scope: PresetScope): string | null {
  if (scope === "organization") return LC_SCHEDULER_COLUMN_IDS.organization;
  if (scope === "team") return LC_SCHEDULER_COLUMN_IDS.team;
  if (scope === "project") return LC_SCHEDULER_COLUMN_IDS.project;
  return null;
}

export function DatabasePropertyPanel({
  databaseId,
  pageId,
}: {
  databaseId: string;
  pageId: string;
}) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const page = usePageStore((s) => s.pages[pageId]);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const addPreset = useDatabaseStore((s) => s.addPreset);
  const updatePreset = useDatabaseStore((s) => s.updatePreset);
  const applyPresetToRow = useDatabaseStore((s) => s.applyPresetToRow);

  // 속성 패널 메뉴는 로컬 상태로 관리 — 글로벌 openColumnMenuId 와 분리해야
  // 피크 뒤 dim 처리된 DB 의 동일 컬럼 헤더 메뉴가 함께 뜨지 않음
  const [localOpenColumnId, setLocalOpenColumnId] = useState<string | null>(null);
  const setOpenColumnMenu = (id: string | null) => setLocalOpenColumnId(id);
  const openColumnMenuId = localOpenColumnId;
  const [showAdd, setShowAdd] = useState(false);
  const [colMenuAnchor, setColMenuAnchor] = useState<HTMLElement | null>(null);

  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetScope, setSavePresetScope] = useState<PresetScope>("workspace");
  const [savePresetScopeId, setSavePresetScopeId] = useState("");
  const [editPresetId, setEditPresetId] = useState<string | null>(null);
  const [editPresetName, setEditPresetName] = useState("");
  const presetMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);

  const hasData = Boolean(bundle && page);
  const rowCells = useMemo(() => page?.dbCells ?? {}, [page?.dbCells]);

  const isSchedulerDb = isLCSchedulerDatabaseId(databaseId);
  const propertyPanelMetaCellId = isSchedulerDb
    ? LC_SCHEDULER_COLUMN_IDS.meta
    : PROPERTY_PANEL_META_CELL_ID;
  const allPropertyColumns = useMemo(
    () => (bundle?.columns ?? []).filter((c) => c.type !== "title"),
    [bundle?.columns],
  );
  const editableColumns = allPropertyColumns.filter((c) => !isLCSchedulerHiddenPropertyColumnId(c.id));
  const presets = useMemo(() => bundle?.presets ?? [], [bundle?.presets]);

  const rowProjectId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.project);
  const rowOrganizationId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.organization);
  const rowTeamId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.team);
  const isSpecialSchedulerCard = isSchedulerDb && !hasAssigneeValue(rowCells[LC_SCHEDULER_COLUMN_IDS.assignees]);
  const rowScopeIdByType = useMemo<Record<PresetScope, string | null>>(
    () => ({
      workspace: null,
      organization: rowOrganizationId,
      team: rowTeamId,
      project: rowProjectId,
    }),
    [rowOrganizationId, rowProjectId, rowTeamId],
  );

  const saveScopeOptions = useMemo(() => {
    if (savePresetScope === "workspace") return [];
    const columnId = scopeColumnId(savePresetScope);
    if (!columnId) return [];
    const column = bundle?.columns.find((c) => c.id === columnId);
    return column?.config?.options ?? [];
  }, [bundle?.columns, savePresetScope]);

  const filteredPresets = useMemo(() => {
    if (!isSchedulerDb) return presets;
    return presets.filter((preset) => {
      const scope = preset.scope as PresetScope;
      if (scope === "workspace") return true;
      const rowScopeId = rowScopeIdByType[scope];
      if (!rowScopeId || !preset.scopeId) return false;
      return rowScopeId === preset.scopeId;
    });
  }, [isSchedulerDb, presets, rowScopeIdByType]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!presetMenuOpen) return;
      if (!presetMenuRef.current?.contains(e.target as Node)) {
        setPresetMenuOpen(false);
        setSavePresetOpen(false);
        setEditPresetId(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [presetMenuOpen]);

  useEffect(() => {
    const fromMeta = readPresetIdFromMeta(rowCells[propertyPanelMetaCellId]);
    if (fromMeta) {
      setSelectedPresetId(fromMeta);
      return;
    }
    if (selectedPresetId && presets.some((preset) => preset.id === selectedPresetId)) return;
    setSelectedPresetId(filteredPresets[0]?.id ?? null);
  }, [filteredPresets, presets, propertyPanelMetaCellId, rowCells, selectedPresetId]);

  useEffect(() => {
    const persistedHiddenColumnIds = readHiddenColumnIdsFromMeta(rowCells[propertyPanelMetaCellId]);
    if (persistedHiddenColumnIds) {
      setHiddenColumnIds(persistedHiddenColumnIds);
      return;
    }
    const preset = presets.find((item) => item.id === selectedPresetId);
    setHiddenColumnIds([...(preset?.hiddenColumnIds ?? [])]);
  }, [presets, propertyPanelMetaCellId, rowCells, selectedPresetId]);

  useEffect(() => {
    if (!isSchedulerDb) return;
    const workspaceId = getLCSchedulerWorkspaceIdFromDatabaseId(databaseId);
    if (!workspaceId) return;
    rememberSchedulerPropertyValues(workspaceId, rowCells);
  }, [databaseId, isSchedulerDb, rowCells]);

  useEffect(() => {
    if (savePresetScope === "workspace") {
      setSavePresetScopeId("");
      return;
    }
    const rowScopeId = rowScopeIdByType[savePresetScope];
    if (rowScopeId) {
      setSavePresetScopeId(rowScopeId);
      return;
    }
    setSavePresetScopeId(saveScopeOptions[0]?.id ?? "");
  }, [rowScopeIdByType, savePresetScope, saveScopeOptions]);

  const activeScopeColumnId = rowProjectId
    ? LC_SCHEDULER_COLUMN_IDS.project
    : rowTeamId
      ? LC_SCHEDULER_COLUMN_IDS.team
      : rowOrganizationId
        ? LC_SCHEDULER_COLUMN_IDS.organization
        : null;
  const effectiveHiddenColumnIds = useMemo(() => {
    const next = new Set(hiddenColumnIds);
    if (activeScopeColumnId) next.delete(activeScopeColumnId);
    if (isSpecialSchedulerCard) {
      next.add(LC_SCHEDULER_COLUMN_IDS.assignees);
    }
    return next;
  }, [activeScopeColumnId, hiddenColumnIds, isSpecialSchedulerCard]);
  const visibleColumns = editableColumns.filter((col) => !effectiveHiddenColumnIds.has(col.id));

  const currentPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;

  function persistHiddenColumnIds(nextHiddenColumnIds: string[]) {
    const latestCells = usePageStore.getState().pages[pageId]?.dbCells ?? rowCells;
    const metaCell = latestCells[propertyPanelMetaCellId];
    const baseMeta = (metaCell && typeof metaCell === "object" && !Array.isArray(metaCell))
      ? { ...(metaCell as Record<string, unknown>) }
      : {};
    updateCell(databaseId, pageId, propertyPanelMetaCellId, {
      ...baseMeta,
      [PROPERTY_HIDDEN_COLUMN_IDS_META_KEY]: nextHiddenColumnIds,
    });
  }

  function applyPresetToCurrentRow(presetId: string) {
    const ok = applyPresetToRow(databaseId, pageId, presetId);
    if (!ok) return;
    const preset = presets.find((item) => item.id === presetId);
    const presetHiddenColumnIds = [...(preset?.hiddenColumnIds ?? [])];
    const latestCells = usePageStore.getState().pages[pageId]?.dbCells ?? rowCells;
    const metaCell = latestCells[propertyPanelMetaCellId];
    const baseMeta = (metaCell && typeof metaCell === "object" && !Array.isArray(metaCell))
      ? { ...(metaCell as Record<string, unknown>) }
      : {};
    updateCell(databaseId, pageId, propertyPanelMetaCellId, {
      ...baseMeta,
      presetId,
      [PROPERTY_HIDDEN_COLUMN_IDS_META_KEY]: presetHiddenColumnIds,
    });
    setSelectedPresetId(presetId);
    setHiddenColumnIds(presetHiddenColumnIds);
  }

  function resolveScopeId(scope: PresetScope): string | undefined {
    if (scope === "workspace") return undefined;
    return savePresetScopeId || undefined;
  }

  function buildPresetColumnDefaults(): Record<string, CellValue> {
    const next: Record<string, CellValue> = {};
    for (const col of allPropertyColumns) {
      const v = rowCells[col.id];
      if (typeof v === "undefined") continue;
      next[col.id] = v;
    }
    const metaCell = next[propertyPanelMetaCellId];
    if (metaCell && typeof metaCell === "object" && !Array.isArray(metaCell)) {
      const {
        presetId: _presetId,
        propertyHiddenColumnIds: _propertyHiddenColumnIds,
        ...metaRest
      } = metaCell as Record<string, CellValue>;
      next[propertyPanelMetaCellId] = {
        ...metaRest,
      };
    }
    return next;
  }

  function handleCreatePresetFromCurrent() {
    const name = savePresetName.trim();
    if (!name) {
      window.alert("프리셋 이름을 입력해 주세요.");
      return;
    }
    const scopeId = resolveScopeId(savePresetScope);
    if (savePresetScope !== "workspace" && !scopeId) {
      window.alert(`${scopeLabel(savePresetScope)} 대상을 선택해 주세요.`);
      return;
    }
    const presetId = addPreset(databaseId, {
      name,
      scope: savePresetScope,
      scopeId,
      columnDefaults: buildPresetColumnDefaults(),
      requiredColumnIds: visibleColumns.map((col) => col.id),
      visibleColumnIds: visibleColumns.map((col) => col.id),
      hiddenColumnIds: hiddenColumnIds.filter((id) => editableColumns.some((col) => col.id === id)),
      schedulerDefaults: currentPreset?.schedulerDefaults,
    });
    setSavePresetName("");
    setSavePresetOpen(false);
    setPresetMenuOpen(false);
    applyPresetToCurrentRow(presetId);
  }

  function startEditPreset(preset: DatabaseRowPreset) {
    setEditPresetId(preset.id);
    setEditPresetName(preset.name);
    setSavePresetOpen(false);
  }

  function handleEditPresetSave() {
    if (!editPresetId) return;
    const name = editPresetName.trim();
    if (!name) return;
    updatePreset(databaseId, editPresetId, {
      name,
      columnDefaults: buildPresetColumnDefaults(),
      requiredColumnIds: visibleColumns.map((col) => col.id),
      visibleColumnIds: visibleColumns.map((col) => col.id),
      hiddenColumnIds: hiddenColumnIds.filter((id) => editableColumns.some((col) => col.id === id)),
    });
    setEditPresetId(null);
    setEditPresetName("");
    setPresetMenuOpen(false);
  }

  const statusLabel = currentPreset ? currentPreset.name : "속성 프리셋";

  if (!hasData || !bundle || !page) return null;

  const presetDropdown = (
    <div className="relative min-w-0" ref={presetMenuRef}>
      <button
        type="button"
        onClick={() => setPresetMenuOpen((v) => !v)}
        className="flex max-w-[180px] items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="min-w-0 truncate">{statusLabel}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {presetMenuOpen && (
        <div className="absolute bottom-full left-0 z-[710] mb-1 w-[300px] rounded border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="max-h-56 space-y-1 overflow-y-auto p-1">
            {filteredPresets.map((preset) => (
              <div
                key={preset.id}
                className={`rounded border px-2 py-1 ${
                  preset.id === selectedPresetId
                    ? "border-amber-300 bg-amber-50 dark:border-amber-500 dark:bg-amber-900/20"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => applyPresetToCurrentRow(preset.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {preset.name}
                    </p>
                    <p className="truncate text-sm text-zinc-400">
                      {scopeLabel(preset.scope as PresetScope)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditPreset(preset)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    title="현재 속성으로 덮어쓰기 편집"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
                {editPresetId === preset.id && (
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      autoFocus
                      value={editPresetName}
                      onChange={(e) => setEditPresetName(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm outline-none focus:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800"
                    />
                    <button
                      type="button"
                      onClick={handleEditPresetSave}
                      className="rounded bg-amber-500 px-2 py-1 text-sm text-white hover:bg-amber-600"
                    >
                      저장
                    </button>
                  </div>
                )}
              </div>
            ))}
            {filteredPresets.length === 0 && (
              <div className="rounded border border-dashed border-zinc-300 px-2 py-3 text-center text-sm text-zinc-400 dark:border-zinc-700">
                선택 가능한 프리셋이 없습니다.
              </div>
            )}
          </div>
          <div className="border-t border-zinc-100 p-1 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setSavePresetOpen((v) => !v);
                setEditPresetId(null);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span>현재 속성값으로 프리셋 저장</span>
              <Save size={11} />
            </button>
            {savePresetOpen && (
              <div className="mt-1 space-y-1 rounded border border-zinc-200 p-2 dark:border-zinc-700">
                <input
                  value={savePresetName}
                  onChange={(e) => setSavePresetName(e.target.value)}
                  placeholder="프리셋 이름"
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800"
                />
                <select
                  value={savePresetScope}
                  onChange={(e) => setSavePresetScope(e.target.value as PresetScope)}
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800"
                >
                  <option value="workspace">프리셋을 모두가 사용</option>
                  <option value="organization">프리셋을 조직에서만 사용</option>
                  <option value="team">프리셋을 팀에서만 사용</option>
                  <option value="project">프리셋을 프로젝트에서만 사용</option>
                </select>
                {savePresetScope !== "workspace" && (
                  <select
                    value={savePresetScopeId}
                    onChange={(e) => setSavePresetScopeId(e.target.value)}
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    {saveScopeOptions.length === 0 && (
                      <option value="">대상 없음</option>
                    )}
                    {saveScopeOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleCreatePresetFromCurrent}
                  className="flex w-full items-center justify-center gap-1 rounded bg-amber-500 px-2 py-1 text-sm text-white hover:bg-amber-600"
                >
                  <Check size={11} />
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="my-3 space-y-1 border-y border-zinc-200 py-3 text-sm dark:border-zinc-800">
      {visibleColumns.map((col) => {
        const value = (col.id in rowCells)
          ? rowCells[col.id]
          : null;
        const colMenuOpen = openColumnMenuId === col.id;
        const hidden = hiddenColumnIds.includes(col.id);
        return (
          <div key={col.id} className="flex items-start gap-2">
            <div className="w-32 shrink-0 pt-0.5 text-zinc-500">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    setOpenColumnMenu(colMenuOpen ? null : col.id);
                    if (!colMenuOpen) setColMenuAnchor(e.currentTarget);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate">{col.name}</span>
                  <ChevronDown size={10} className="shrink-0 opacity-60" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = hiddenColumnIds.includes(col.id)
                      ? hiddenColumnIds
                      : [...hiddenColumnIds, col.id];
                    setHiddenColumnIds(next);
                    persistHiddenColumnIds(next);
                  }}
                  className="rounded p-1 opacity-70 hover:bg-zinc-100 hover:opacity-100 dark:hover:bg-zinc-800"
                  title={hidden ? "속성 표시" : "속성 숨기기"}
                >
                  {hidden ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
              </div>
              {colMenuOpen && colMenuAnchor && (
                <DatabaseColumnMenu
                  databaseId={databaseId}
                  column={col}
                  anchorEl={colMenuAnchor}
                  onClose={() => { setOpenColumnMenu(null); setColMenuAnchor(null); }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DatabaseCell
                databaseId={databaseId}
                rowId={pageId}
                column={col}
                value={value}
              />
            </div>
          </div>
        );
      })}

      {hiddenColumnIds.length > 0 && (
        <div className="pt-1">
          <div className="mb-1 text-[11px] text-zinc-400">비활성화 속성</div>
          <div className="flex flex-wrap gap-1">
            {hiddenColumnIds
              .map((id) => editableColumns.find((col) => col.id === id))
              .filter((col): col is NonNullable<typeof col> => Boolean(col))
              .map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => {
                    const next = hiddenColumnIds.filter((id) => id !== col.id);
                    setHiddenColumnIds(next);
                    persistHiddenColumnIds(next);
                  }}
                  className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {col.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        {showAdd ? (
          <select
            autoFocus
            defaultValue=""
            onBlur={() => setShowAdd(false)}
            onChange={(e) => {
              const t = e.target.value as ColumnType | "";
              if (t) {
                const label = COLUMN_TYPES.find((x) => x.id === t)?.label ?? "속성";
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t, `${label} ${idx}`));
              }
              setShowAdd(false);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">선택…</option>
            {COLUMN_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 속성 추가
          </button>
        )}
        {presetDropdown}
      </div>
    </div>
  );
}
