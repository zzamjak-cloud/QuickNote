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

function readPresetIdFromMeta(metaCell: CellValue): string | null {
  if (!metaCell || typeof metaCell !== "object" || Array.isArray(metaCell)) return null;
  const candidate = (metaCell as Record<string, unknown>).presetId;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
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
  const allPropertyColumns = useMemo(
    () => (bundle?.columns ?? []).filter((c) => c.type !== "title"),
    [bundle?.columns],
  );
  const editableColumns = allPropertyColumns.filter((c) => !isLCSchedulerHiddenPropertyColumnId(c.id));
  const presets = useMemo(() => bundle?.presets ?? [], [bundle?.presets]);

  const rowProjectId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.project);
  const rowOrganizationId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.organization);
  const rowTeamId = readRowStringCell(rowCells, LC_SCHEDULER_COLUMN_IDS.team);
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
    const fromMeta = readPresetIdFromMeta(rowCells[LC_SCHEDULER_COLUMN_IDS.meta]);
    if (fromMeta) {
      setSelectedPresetId(fromMeta);
      return;
    }
    if (selectedPresetId && presets.some((preset) => preset.id === selectedPresetId)) return;
    setSelectedPresetId(filteredPresets[0]?.id ?? null);
  }, [rowCells, filteredPresets, presets, selectedPresetId]);

  useEffect(() => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    setHiddenColumnIds([...(preset?.hiddenColumnIds ?? [])]);
  }, [presets, selectedPresetId]);

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

  const visibleColumns = editableColumns.filter((col) => !hiddenColumnIds.includes(col.id));

  const currentPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;

  function applyPresetToCurrentRow(presetId: string) {
    const ok = applyPresetToRow(databaseId, pageId, presetId);
    if (!ok) return;
    const metaCell = rowCells[LC_SCHEDULER_COLUMN_IDS.meta];
    const baseMeta = (metaCell && typeof metaCell === "object" && !Array.isArray(metaCell))
      ? { ...(metaCell as Record<string, unknown>) }
      : {};
    updateCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.meta, {
      ...baseMeta,
      presetId,
    });
    setSelectedPresetId(presetId);
    const preset = presets.find((item) => item.id === presetId);
    if (preset) setHiddenColumnIds([...(preset.hiddenColumnIds ?? [])]);
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
    const metaCell = next[LC_SCHEDULER_COLUMN_IDS.meta];
    if (metaCell && typeof metaCell === "object" && !Array.isArray(metaCell)) {
      const { presetId: _presetId, ...metaRest } = metaCell as Record<string, CellValue>;
      next[LC_SCHEDULER_COLUMN_IDS.meta] = {
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

  return (
    <div className="my-3 space-y-1 border-y border-zinc-200 py-3 text-sm dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="relative" ref={presetMenuRef}>
          <button
            type="button"
            onClick={() => setPresetMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <span className="max-w-[210px] truncate">{statusLabel}</span>
            <ChevronDown size={12} />
          </button>

          {presetMenuOpen && (
            <div className="absolute left-0 top-full z-[710] mt-1 w-[300px] rounded border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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
      </div>

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
                    setHiddenColumnIds((prev) => (prev.includes(col.id) ? prev : [...prev, col.id]));
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
                    setHiddenColumnIds((prev) => prev.filter((id) => id !== col.id));
                  }}
                  className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {col.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="pt-2">
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
      </div>
    </div>
  );
}
