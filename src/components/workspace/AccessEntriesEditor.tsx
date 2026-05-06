import { useCallback, useMemo, useState } from "react";
import { useMemberStore } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import type { WorkspaceAccessInput } from "../../lib/sync/workspaceApi";

type Props = {
  value: WorkspaceAccessInput[];
  onChange: (next: WorkspaceAccessInput[]) => void;
  onWarning?: (message: string) => void;
};

export function AccessEntriesEditor({ value, onChange, onWarning }: Props) {
  const members = useMemberStore((s) => s.members);
  const teams = useTeamStore((s) => s.teams);
  const [subjectType, setSubjectType] = useState<WorkspaceAccessInput["subjectType"]>("EVERYONE");
  const [subjectId, setSubjectId] = useState("");

  const memberNameById = useMemo(
    () => new Map(members.map((m) => [m.memberId, m.name])),
    [members],
  );
  const teamNameById = useMemo(
    () => new Map(teams.map((t) => [t.teamId, t.name])),
    [teams],
  );

  const subjectOptions = useMemo(() => {
    if (subjectType === "TEAM") return teams.map((t) => ({ id: t.teamId, label: t.name }));
    if (subjectType === "MEMBER") return members.map((m) => ({ id: m.memberId, label: `${m.name} (${m.email})` }));
    return [];
  }, [subjectType, teams, members]);

  const upsert = (level: "EDIT" | "VIEW") => {
    const resolvedSubjectId = subjectType === "EVERYONE" ? undefined : subjectId || undefined;
    if (subjectType !== "EVERYONE" && !resolvedSubjectId) return;

    const key = `${subjectType}:${resolvedSubjectId ?? "*"}`;
    const existingIdx = value.findIndex(
      (v) => `${v.subjectType}:${v.subjectId ?? "*"}` === key,
    );
    const next = [...value];
    if (existingIdx >= 0) {
      const prev = next[existingIdx]!;
      if (prev.level !== level && level === "EDIT") {
        onWarning?.("같은 대상의 view/edit 중복은 edit 우선으로 정리되었습니다.");
      }
      next[existingIdx] = { ...prev, level };
    } else {
      next.push({ subjectType, subjectId: resolvedSubjectId, level });
    }
    onChange(next);
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const describeEntry = useCallback((entry: WorkspaceAccessInput) => {
    const action =
      entry.level === "EDIT" ? "편집할 수 있습니다." : "미리 보기만 가능합니다.";
    if (entry.subjectType === "EVERYONE") return `모든 구성원이 ${action}`;
    if (entry.subjectType === "TEAM") {
      const teamName = entry.subjectId ? (teamNameById.get(entry.subjectId) ?? "알 수 없는 팀") : "팀";
      return `${teamName} 팀원들만 ${action}`;
    }
    const memberName = entry.subjectId ? (memberNameById.get(entry.subjectId) ?? "알 수 없는 구성원") : "구성원";
    return `${memberName} 구성원만 ${action}`;
  }, [memberNameById, teamNameById]);

  const effectiveSummary = useMemo(() => {
    const everyoneRule = value.find((v) => v.subjectType === "EVERYONE") ?? null;
    if (!everyoneRule) {
      return "아직 기본 규칙(모든 구성원 대상)이 없습니다. 필요하면 '모든 구성원 + 보기 권한'을 먼저 추가하세요.";
    }
    const teamOrMemberOverrides = value.filter((v) => v.subjectType !== "EVERYONE");
    if (teamOrMemberOverrides.length === 0) {
      return describeEntry(everyoneRule);
    }
    const overrideDescriptions = teamOrMemberOverrides.map((entry) => {
      const action =
        entry.level === "EDIT" ? "편집 가능" : "보기만 가능";
      if (entry.subjectType === "TEAM") {
        const teamName = entry.subjectId ? (teamNameById.get(entry.subjectId) ?? "알 수 없는 팀") : "팀";
        return `${teamName} 팀원은 ${action}`;
      }
      const memberName = entry.subjectId ? (memberNameById.get(entry.subjectId) ?? "알 수 없는 구성원") : "구성원";
      return `${memberName} 구성원은 ${action}`;
    });
    return `기본 규칙: ${describeEntry(everyoneRule)} / 예외 규칙: ${overrideDescriptions.join(", ")}`;
  }, [value, describeEntry, teamNameById, memberNameById]);

  const selectionPreview = useMemo(() => {
    if (subjectType === "EVERYONE") {
      return "모든 구성원을 대상으로 권한을 추가합니다.";
    }
    if (!subjectId) {
      return subjectType === "TEAM"
        ? "대상을 선택하면 'CAT 팀원들만 편집할 수 있습니다.'처럼 표시됩니다."
        : "대상을 선택하면 '홍길동 구성원만 미리 보기만 가능합니다.'처럼 표시됩니다.";
    }
    if (subjectType === "TEAM") {
      const teamName = teamNameById.get(subjectId) ?? "선택한 팀";
      return `${teamName} 팀원들을 대상으로 권한을 추가합니다.`;
    }
    const memberName = memberNameById.get(subjectId) ?? "선택한 구성원";
    return `${memberName} 구성원을 대상으로 권한을 추가합니다.`;
  }, [subjectType, subjectId, teamNameById, memberNameById]);

  return (
    <div className="space-y-2">
      <div className="rounded border border-zinc-200 p-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        {selectionPreview}
      </div>
      <div className="rounded border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
        현재 적용 상태: {effectiveSummary}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <select
          aria-label="subject-type"
          value={subjectType}
          onChange={(e) => {
            setSubjectType(e.target.value as WorkspaceAccessInput["subjectType"]);
            setSubjectId("");
          }}
          className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="EVERYONE">모든 구성원</option>
          <option value="TEAM">특정 팀</option>
          <option value="MEMBER">특정 구성원</option>
        </select>
        <select
          aria-label="subject-id"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={subjectType === "EVERYONE"}
          className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{subjectType === "EVERYONE" ? "모든 구성원 적용" : "대상 선택"}</option>
          {subjectOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => upsert("EDIT")}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          편집 권한 추가
        </button>
        <button
          type="button"
          onClick={() => upsert("VIEW")}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          보기 권한 추가
        </button>
      </div>

      <ul className="space-y-1 text-xs">
        {value.map((v, idx) => (
          <li key={`${v.subjectType}-${v.subjectId ?? "*"}-${idx}`} className="flex items-center justify-between rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700">
            <span>
              {v.subjectType === "EVERYONE" ? `기본 규칙 - ${describeEntry(v)}` : `예외 규칙 - ${describeEntry(v)}`}
            </span>
            <button type="button" onClick={() => remove(idx)} className="text-zinc-500 hover:text-red-600">
              제거
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
