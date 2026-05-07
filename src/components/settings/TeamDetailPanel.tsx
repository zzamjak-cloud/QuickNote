import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { updateTeamApi } from "../../lib/sync/teamApi";
import { assignMemberToTeamApi, unassignMemberFromTeamApi } from "../../lib/sync/memberApi";
import { useMemberStore } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import type { Team } from "../../store/teamStore";

type Props = {
  team: Team | null;
};

export function TeamDetailPanel({ team }: Props) {
  const allMembers = useMemberStore((s) => s.members);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const membersById = useMemo(
    () => new Map(allMembers.map((m) => [m.memberId, m])),
    [allMembers],
  );

  const [editName, setEditName] = useState(team?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");

  const filteredNonMembers = useMemo(() => {
    if (!team) return [];
    const teamMemberIds = new Set(team.members.map((m) => m.memberId));
    const q = memberQuery.trim().toLowerCase();
    return allMembers
      .filter((m) => !teamMemberIds.has(m.memberId) && m.status === "active")
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
  }, [allMembers, team, memberQuery]);

  if (!team) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        팀을 선택하면 멤버를 볼 수 있습니다.
      </div>
    );
  }

  const handleSaveName = async () => {
    const name = editName.trim();
    if (!name || name === team.name) return;
    setSavingName(true);
    try {
      const updated = await updateTeamApi(team.teamId, name);
      upsertTeam(updated);
    } finally {
      setSavingName(false);
    }
  };

  const handleAddMember = async (memberId: string) => {
    await assignMemberToTeamApi(memberId, team.teamId);
    const member = membersById.get(memberId);
    if (member) {
      upsertTeam({ ...team, members: [...team.members, member] });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    await unassignMemberFromTeamApi(memberId, team.teamId);
    upsertTeam({ ...team, members: team.members.filter((m) => m.memberId !== memberId) });
  };

  const nameDirty = editName.trim() !== team.name;

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      {/* 팀 이름 편집 */}
      <div className="flex items-center gap-2">
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSaveName()}
          className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
        />
        <button
          type="button"
          onClick={() => void handleSaveName()}
          disabled={!nameDirty || savingName}
          className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          {savingName ? "저장 중..." : "이름 변경"}
        </button>
      </div>

      {/* 현재 멤버 목록 */}
      <div className="text-[10px] font-medium text-zinc-500">멤버 ({team.members.length})</div>
      <ul className="max-h-40 overflow-y-auto text-xs">
        {team.members.length === 0 ? (
          <li className="py-2 text-center text-zinc-400">멤버가 없습니다.</li>
        ) : (
          team.members.map((m) => (
            <li
              key={m.memberId}
              className="flex items-center justify-between border-t border-zinc-100 py-1.5 first:border-t-0 dark:border-zinc-800"
            >
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="ml-1 text-zinc-400">{m.email}</span>
              </span>
              <button
                type="button"
                onClick={() => void handleRemoveMember(m.memberId)}
                className="text-[10px] text-zinc-400 hover:text-red-500"
              >
                제거
              </button>
            </li>
          ))
        )}
      </ul>

      {/* 구성원 검색하여 추가 */}
      <div className="text-[10px] font-medium text-zinc-500">구성원 추가</div>
      <div className="flex items-center gap-1.5 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700">
        <Search size={12} className="text-zinc-400" />
        <input
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          placeholder="구성원 검색하여 추가..."
          className="flex-1 bg-transparent text-xs outline-none"
        />
      </div>
      {memberQuery && (
        <ul className="max-h-32 overflow-y-auto rounded border border-zinc-200 text-xs dark:border-zinc-700">
          {filteredNonMembers.length === 0 ? (
            <li className="px-2 py-2 text-zinc-400">검색 결과 없음</li>
          ) : (
            filteredNonMembers.map((m) => (
              <li
                key={m.memberId}
                className="flex items-center justify-between px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span>
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-1 text-zinc-400">{m.email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleAddMember(m.memberId)}
                  className="text-[10px] text-blue-500 hover:text-blue-700"
                >
                  추가
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
