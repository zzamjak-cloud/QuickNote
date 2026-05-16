import { useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { ColorPickerGrid } from "../ColorPickerGrid";
import {
  LC_SCHEDULER_COLUMN_IDS,
  makeLCSchedulerDatabaseId,
} from "../../../lib/scheduler/database";
import { DEFAULT_SCHEDULE_COLOR } from "../../../lib/scheduler/colors";
import type { CellValue, DatabaseRowPreset, SelectOption } from "../../../types/database";

const SYSTEM_PRESET_IDS = new Set([
  "lc-scheduler-preset:task",
  "lc-scheduler-preset:annual-leave",
]);

type Draft = {
  name: string;
  description: string;
  title: string;
  status: string;
  color: string;
  durationDays: number;
  titlePrefix: string;
  kind: "schedule" | "leave";
  assigneeIds: string[];
};

function buildDraft(preset: DatabaseRowPreset): Draft {
  const title = preset.columnDefaults[LC_SCHEDULER_COLUMN_IDS.title];
  const status = preset.columnDefaults[LC_SCHEDULER_COLUMN_IDS.status];
  const color = preset.columnDefaults[LC_SCHEDULER_COLUMN_IDS.color];
  const meta = preset.columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta];
  const metaKind = (typeof meta === "object" && meta && "kind" in meta)
    ? String((meta as { kind?: unknown }).kind)
    : "schedule";
  return {
    name: preset.name,
    description: preset.description ?? "",
    title: typeof title === "string" ? title : "",
    status: typeof status === "string" ? status : "",
    color: typeof color === "string" ? color : DEFAULT_SCHEDULE_COLOR,
    durationDays: Math.max(1, Number(preset.schedulerDefaults?.durationDays ?? 1)),
    titlePrefix: preset.schedulerDefaults?.titlePrefix ?? "",
    kind: metaKind === "leave" ? "leave" : "schedule",
    assigneeIds: [...(preset.schedulerDefaults?.assigneeIds ?? [])],
  };
}

export function PropertyPresetsPanel() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const activeMembers = useMemberStore((s) => s.members.filter((m) => m.status === "active"));
  const { databases, addPreset, updatePreset, deletePreset } = useDatabaseStore();

  const databaseId = workspaceId ? makeLCSchedulerDatabaseId(workspaceId) : null;
  const bundle = databaseId ? databases[databaseId] : undefined;
  const presets = bundle?.presets ?? [];
  const statusOptions = useMemo<SelectOption[]>(
    () => (
      bundle?.columns.find((c) => c.id === LC_SCHEDULER_COLUMN_IDS.status)?.config?.options ?? []
    ),
    [bundle],
  );

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const selectedPreset = presets.find((p) => p.id === selectedPresetId) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);

  function selectPreset(preset: DatabaseRowPreset) {
    setSelectedPresetId(preset.id);
    setDraft(buildDraft(preset));
  }

  function handleAddPreset() {
    if (!bundle || !databaseId) return;
    const base = presets.find((p) => p.id === "lc-scheduler-preset:task") ?? presets[0];
    const id = addPreset(databaseId, {
      name: "새 속성 프리셋",
      description: "",
      scope: "workspace",
      columnDefaults: {
        [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
        [LC_SCHEDULER_COLUMN_IDS.color]: DEFAULT_SCHEDULE_COLOR,
        [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "schedule" },
      },
      requiredColumnIds: [...(base?.requiredColumnIds ?? [])],
      visibleColumnIds: [...(base?.visibleColumnIds ?? [])],
      hiddenColumnIds: [...(base?.hiddenColumnIds ?? [])],
      schedulerDefaults: { durationDays: 1, color: DEFAULT_SCHEDULE_COLOR },
    });
    const created = useDatabaseStore.getState().databases[databaseId]?.presets?.find((p) => p.id === id);
    if (created) selectPreset(created);
  }

  function handleDeletePreset(presetId: string) {
    if (!databaseId) return;
    if (SYSTEM_PRESET_IDS.has(presetId)) {
      window.alert("기본 프리셋은 삭제할 수 없습니다.");
      return;
    }
    if (!window.confirm("이 프리셋을 삭제하시겠습니까?")) return;
    deletePreset(databaseId, presetId);
    if (selectedPresetId === presetId) {
      setSelectedPresetId(null);
      setDraft(null);
    }
  }

  function handleSavePreset() {
    if (!databaseId || !selectedPreset || !draft) return;
    const columnDefaults: Record<string, CellValue> = {
      ...selectedPreset.columnDefaults,
      [LC_SCHEDULER_COLUMN_IDS.status]: draft.status,
      [LC_SCHEDULER_COLUMN_IDS.color]: draft.color,
      [LC_SCHEDULER_COLUMN_IDS.meta]: draft.kind === "leave"
        ? { kind: "leave", annualLeave: true }
        : { kind: "schedule" },
    };
    if (draft.title.trim()) {
      columnDefaults[LC_SCHEDULER_COLUMN_IDS.title] = draft.title.trim();
    } else {
      delete columnDefaults[LC_SCHEDULER_COLUMN_IDS.title];
    }
    updatePreset(databaseId, selectedPreset.id, {
      name: draft.name.trim() || "이름 없는 프리셋",
      description: draft.description.trim() || undefined,
      columnDefaults,
      schedulerDefaults: {
        ...selectedPreset.schedulerDefaults,
        durationDays: Math.max(1, Number(draft.durationDays || 1)),
        color: draft.color,
        titlePrefix: draft.titlePrefix.trim() || undefined,
        assigneeIds: [...draft.assigneeIds],
      },
    });
  }

  if (!workspaceId) {
    return <div className="text-sm text-zinc-500">워크스페이스를 먼저 선택해 주세요.</div>;
  }

  if (!bundle || !databaseId) {
    return (
      <div className="text-sm text-zinc-500">
        스케줄러 데이터베이스를 불러오는 중입니다. 잠시 후 다시 열어 주세요.
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="rounded border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">프리셋 목록</span>
          <button
            type="button"
            onClick={handleAddPreset}
            className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600"
          >
            <Plus size={12} />
            추가
          </button>
        </div>
        <div className="max-h-[420px] space-y-1 overflow-y-auto p-2">
          {presets.map((preset) => {
            const active = preset.id === selectedPresetId;
            return (
              <div
                key={preset.id}
                className={`rounded border p-2 ${
                  active
                    ? "border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-900/20"
                    : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className="w-full text-left"
                >
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {preset.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {preset.description || "설명 없음"}
                  </p>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">
                    {SYSTEM_PRESET_IDS.has(preset.id) ? "기본 프리셋" : "사용자 프리셋"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeletePreset(preset.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    title="삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {presets.length === 0 && (
            <div className="rounded border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-400 dark:border-zinc-700">
              프리셋이 없습니다.
            </div>
          )}
        </div>
      </div>

      <div className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
        {!selectedPreset || !draft && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            왼쪽에서 프리셋을 선택해 주세요.
          </div>
        )}

        {selectedPreset && draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">프리셋 이름</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">카드 타입</label>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as "schedule" | "leave" })}
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="schedule">일정</option>
                  <option value="leave">연차</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">설명</label>
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">기본 제목</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="예: 연차"
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">상태 기본값</label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {statusOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">기본 기간(일)</label>
                <input
                  type="number"
                  min={1}
                  value={draft.durationDays}
                  onChange={(e) => setDraft({ ...draft, durationDays: Math.max(1, Number(e.target.value || 1)) })}
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">제목 접두어</label>
                <input
                  type="text"
                  value={draft.titlePrefix}
                  onChange={(e) => setDraft({ ...draft, titlePrefix: e.target.value })}
                  placeholder="예: 연차"
                  className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-zinc-500 dark:text-zinc-400">기본 카드 색상</label>
              <ColorPickerGrid value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-zinc-500 dark:text-zinc-400">기본 작업자</label>
              <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/40">
                {activeMembers.map((member) => {
                  const checked = draft.assigneeIds.includes(member.memberId);
                  return (
                    <label
                      key={member.memberId}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setDraft((prev) => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              assigneeIds: checked
                                ? prev.assigneeIds.filter((id) => id !== member.memberId)
                                : [...prev.assigneeIds, member.memberId],
                            };
                          });
                        }}
                        className="accent-amber-500"
                      />
                      <span className="truncate">{member.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSavePreset}
                className="inline-flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600"
              >
                <Save size={12} />
                프리셋 저장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
