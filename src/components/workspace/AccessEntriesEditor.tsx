import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import { useMemberStore } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import type { WorkspaceAccessInput } from "../../lib/sync/workspaceApi";

type Level = "EDIT" | "VIEW";
type SubjectType = "MEMBER" | "TEAM" | "EVERYONE";

type RuleRow = WorkspaceAccessInput & { _key: string };

function makeKey(e: WorkspaceAccessInput): string {
  return `${e.subjectType}:${e.subjectId ?? "*"}`;
}

function SortableRule({
  rule,
  index,
  label,
  onRemove,
  onLevelChange,
}: {
  rule: RuleRow;
  index: number;
  label: string;
  onRemove: () => void;
  onLevelChange: (level: Level) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: rule._key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isEveryone = rule.subjectType === "EVERYONE";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mb-1 grid grid-cols-[14px_56px_1fr_auto_auto] items-center gap-1.5 rounded border px-2 py-1.5 text-sm ${
        isEveryone
          ? "border-dashed border-zinc-300 bg-zinc-50 opacity-80 dark:border-zinc-700 dark:bg-zinc-900"
          : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
      }`}
    >
      <span
        {...(isEveryone ? {} : { ...attributes, ...listeners })}
        className={`cursor-grab text-zinc-400 ${isEveryone ? "cursor-not-allowed opacity-30" : ""}`}
      >
        <GripVertical size={12} />
      </span>
      <span
        className={`rounded px-1 py-0.5 text-center text-xs font-bold ${
          isEveryone
            ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
            : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        }`}
      >
        {index + 1}순위
      </span>
      <span className="truncate text-zinc-700 dark:text-zinc-300">{label}</span>
      <select
        value={rule.level}
        onChange={(e) => onLevelChange(e.target.value as Level)}
        disabled={isEveryone}
        className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-[10px] outline-none dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50"
      >
        <option value="EDIT">모든 편집 가능</option>
        <option value="VIEW">보기만 가능</option>
      </select>
      <button type="button" onClick={onRemove}
        className="text-zinc-400 hover:text-red-500">✕</button>
    </div>
  );
}

type Props = {
  value: WorkspaceAccessInput[];
  onChange: (next: WorkspaceAccessInput[]) => void;
};

export function AccessEntriesEditor({ value, onChange }: Props) {
  const members = useMemberStore((s) => s.members);
  const teams = useTeamStore((s) => s.teams);
  const [addType, setAddType] = useState<SubjectType>("MEMBER");
  const [addSubjectId, setAddSubjectId] = useState("");
  const [addLevel, setAddLevel] = useState<Level>("EDIT");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const memberNameById = useMemo(() => new Map(members.map((m) => [m.memberId, m.name])), [members]);
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.teamId, t.name])), [teams]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // EVERYONE 규칙은 항상 마지막 고정
  const everyoneEntry = useMemo(() => value.find((v) => v.subjectType === "EVERYONE"), [value]);
  const priorityEntries = useMemo(() => value.filter((v) => v.subjectType !== "EVERYONE"), [value]);

  const rows: RuleRow[] = useMemo(() => [
    ...priorityEntries.map((e) => ({ ...e, _key: makeKey(e) })),
    ...(everyoneEntry ? [{ ...everyoneEntry, _key: "EVERYONE:*" }] : []),
  ], [priorityEntries, everyoneEntry]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // EVERYONE 항목은 이동 불가
    const activeKey = active.id as string;
    const overKey = over.id as string;
    if (activeKey === "EVERYONE:*" || overKey === "EVERYONE:*") return;

    const oldIdx = priorityEntries.findIndex((e) => makeKey(e) === activeKey);
    const newIdx = priorityEntries.findIndex((e) => makeKey(e) === overKey);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(priorityEntries, oldIdx, newIdx);
    onChange([...reordered, ...(everyoneEntry ? [everyoneEntry] : [])]);
  };

  const getLabel = useCallback((e: WorkspaceAccessInput): string => {
    if (e.subjectType === "EVERYONE") return "🌐 모든 구성원";
    if (e.subjectType === "TEAM") {
      return `👥 ${e.subjectId ? (teamNameById.get(e.subjectId) ?? "팀") : "팀"}`;
    }
    return `👤 ${e.subjectId ? (memberNameById.get(e.subjectId) ?? "구성원") : "구성원"}`;
  }, [memberNameById, teamNameById]);

  const searchResults = useMemo(() => {
    if (addType === "EVERYONE") return [];
    const q = query.trim().toLowerCase();
    if (addType === "TEAM") {
      return teams
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .slice(0, 8);
    }
    return members
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [addType, query, teams, members]);

  const handleAdd = () => {
    const resolvedId = addType === "EVERYONE" ? undefined : addSubjectId || undefined;
    if (addType !== "EVERYONE" && !resolvedId) return;
    const key = `${addType}:${resolvedId ?? "*"}`;
    const existing = value.findIndex((v) => makeKey(v) === key);
    if (existing >= 0) return;
    const newEntry: WorkspaceAccessInput = { subjectType: addType, subjectId: resolvedId, level: addLevel };
    // 새 규칙은 맨 앞(최고 우선순위)에 추가, EVERYONE은 맨 뒤 유지
    onChange([newEntry, ...priorityEntries, ...(everyoneEntry ? [everyoneEntry] : [])]);
    setAddSubjectId("");
    setQuery("");
    setShowAdd(false);
  };

  return (
    <div className="space-y-2">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          접근 규칙
          <span className="ml-1 text-xs font-normal text-zinc-400">낮은 숫자의 규칙을 최우선 적용합니다.</span>
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-0.5 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">
          <Plus size={10} /> 규칙 추가
        </button>
      </div>

      {/* 규칙 추가 폼 */}
      {showAdd && (
        <div className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={addType} onChange={(e) => { setAddType(e.target.value as SubjectType); setAddSubjectId(""); setQuery(""); }}
              className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900">
              <option value="MEMBER">👤 특정 구성원</option>
              <option value="TEAM">👥 특정 팀</option>
              <option value="EVERYONE">🌐 모든 구성원</option>
            </select>
            {addType !== "EVERYONE" && (
              <div className="relative">
                <input value={query} onChange={(e) => { setQuery(e.target.value); setAddSubjectId(""); }}
                  placeholder={addType === "TEAM" ? "팀 검색..." : "구성원 검색..."}
                  className="w-36 rounded border border-blue-400 px-2 py-1 text-xs outline-none" />
                {query && searchResults.length > 0 && (
                  <div className="absolute left-0 top-full z-10 mt-0.5 w-48 rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {searchResults.map((item) => {
                      const id = "teamId" in item ? item.teamId : item.memberId;
                      const label = "teamId" in item ? item.name : `${item.name} (${item.email})`;
                      return (
                        <button key={id} type="button"
                          onClick={() => { setAddSubjectId(id); setQuery("teamId" in item ? item.name : item.name); }}
                          className="block w-full px-2 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <select value={addLevel} onChange={(e) => setAddLevel(e.target.value as Level)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900">
              <option value="EDIT">모든 편집 가능</option>
              <option value="VIEW">보기만 가능</option>
            </select>
          </div>
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={handleAdd}
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">추가</button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="rounded border px-2 py-1 text-xs">취소</button>
          </div>
        </div>
      )}

      {/* 규칙 목록 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((r) => r._key)} strategy={verticalListSortingStrategy}>
          {rows.map((rule, idx) => (
            <SortableRule
              key={rule._key}
              rule={rule}
              index={idx}
              label={getLabel(rule)}
              onRemove={() => onChange(value.filter((v) => makeKey(v) !== rule._key))}
              onLevelChange={(level) => onChange(value.map((v) => makeKey(v) === rule._key ? { ...v, level } : v))}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
