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
}: {
  rule: RuleRow;
  index: number;
  label: string;
  onRemove: () => void;
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
      className={`mb-1 grid grid-cols-[14px_20px_1fr_auto_auto] items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
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
        className={`rounded px-0.5 py-0.5 text-center text-[8px] font-bold ${
          isEveryone
            ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
            : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        }`}
      >
        {isEveryone ? "∞" : index + 1}
      </span>
      <span className="truncate text-zinc-700 dark:text-zinc-300">{label}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
          rule.level === "EDIT"
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
        }`}
      >
        {rule.level === "EDIT" ? "편집" : "보기"}
      </span>
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

  // 결과 미리보기
  const preview = useMemo(() => {
    const previewList: { label: string; level: string; reason: string }[] = [];
    for (const e of rows) {
      if (e.subjectType === "EVERYONE") {
        previewList.push({ label: "그 외 구성원", level: e.level === "EDIT" ? "편집" : "보기", reason: "기본값" });
      } else if (e.subjectType === "TEAM") {
        const name = e.subjectId ? (teamNameById.get(e.subjectId) ?? "팀") : "팀";
        previewList.push({ label: `${name} 팀원`, level: e.level === "EDIT" ? "편집" : "보기", reason: `${rows.indexOf(e) + 1}순위` });
      } else {
        const name = e.subjectId ? (memberNameById.get(e.subjectId) ?? "구성원") : "구성원";
        previewList.push({ label: name, level: e.level === "EDIT" ? "편집" : "보기", reason: `${rows.indexOf(e) + 1}순위` });
      }
    }
    return previewList;
  }, [rows, memberNameById, teamNameById]);

  return (
    <div className="space-y-2">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">
          접근 규칙
          <span className="ml-1 text-[10px] font-normal text-zinc-400">(위의 규칙이 먼저 적용)</span>
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-0.5 rounded border border-zinc-300 px-2 py-1 text-[10px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
          <Plus size={10} /> 규칙 추가
        </button>
      </div>

      {/* 규칙 추가 폼 */}
      {showAdd && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-zinc-200 p-2 dark:border-zinc-700">
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
            <option value="EDIT">편집 권한</option>
            <option value="VIEW">보기 권한</option>
          </select>
          <button type="button" onClick={handleAdd}
            className="rounded bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">추가</button>
          <button type="button" onClick={() => setShowAdd(false)}
            className="rounded border px-2 py-1 text-xs">취소</button>
          <span className="text-[9px] text-zinc-400">새 규칙은 최고 우선순위로 추가됩니다</span>
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
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* 결과 미리보기 */}
      {preview.length > 0 && (
        <div className="rounded border border-green-200 bg-green-50 p-2 text-[10px] text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300">
          <div className="mb-1 font-medium">✓ 적용 결과 미리보기</div>
          {preview.map((p) => (
            <div key={p.label}>• {p.label} → <strong>{p.level}</strong> <span className="text-green-600 dark:text-green-400">({p.reason})</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
