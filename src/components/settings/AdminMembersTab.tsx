import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { createMemberApi } from "../../lib/sync/memberApi";
import { useMemberStore, type Member } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import { CreateMemberModal } from "./CreateMemberModal";
import { MemberModal } from "./MemberModal";
import { MemberRowActions } from "./MemberRowActions";

function toUpperRole(role: Member["workspaceRole"]): "OWNER" | "MANAGER" | "MEMBER" {
  if (role === "owner") return "OWNER";
  if (role === "manager") return "MANAGER";
  return "MEMBER";
}

export function AdminMembersTab() {
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);
  const teams = useTeamStore((s) => s.teams);
  const upsertMember = useMemberStore((s) => s.upsertMember);
  const removeMemberFromCache = useMemberStore((s) => s.removeMemberFromCache);
  const [query, setQuery] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const teamNamesByMemberId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const team of teams) {
      for (const m of team.members) {
        const list = map.get(m.memberId) ?? [];
        list.push(team.name);
        map.set(m.memberId, list);
      }
    }
    return map;
  }, [teams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const teamInfo = (teamNamesByMemberId.get(m.memberId) ?? []).join(" ").toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.jobRole.toLowerCase().includes(q) ||
        teamInfo.includes(q)
      );
    });
  }, [members, query, teamNamesByMemberId]);

  const onCreate = async (input: { email: string; name: string; jobRole: string }) => {
    const created = await createMemberApi({
      ...input,
      workspaceRole: "MEMBER",
    });
    upsertMember({
      ...created,
      workspaceRole: created.workspaceRole ?? "member",
      status: created.status ?? "active",
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">구성원 관리</h3>
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <Plus size={12} />
          구성원 추가
        </button>
      </div>

      <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
        <Search size={13} className="text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름/이메일/직무 검색"
          className="flex-1 bg-transparent text-xs outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">이메일</th>
              <th className="px-3 py-2 font-medium">직무</th>
              <th className="px-3 py-2 font-medium">권한</th>
              <th className="px-3 py-2 font-medium">팀정보</th>
              <th className="px-3 py-2 font-medium">액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-zinc-500">
                  결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr
                  key={m.memberId}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                  onClick={() => setSelectedMember(m)}
                >
                  <td className="whitespace-nowrap px-3 py-2">{m.name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{m.email}</td>
                  <td className="whitespace-nowrap px-3 py-2">{m.jobRole}</td>
                  <td className="whitespace-nowrap px-3 py-2">{toUpperRole(m.workspaceRole)}</td>
                  <td className="min-w-[220px] px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {teamNamesByMemberId.get(m.memberId)?.join(", ") || "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <MemberRowActions
                      meRole={me?.workspaceRole ?? "member"}
                      member={m}
                      onMemberUpdated={(updated) =>
                        upsertMember({
                          ...updated,
                          workspaceRole: updated.workspaceRole ?? "member",
                          status: updated.status ?? "active",
                        })
                      }
                      onMemberRemoved={(memberId) => removeMemberFromCache(memberId)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateMemberModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreate={onCreate}
      />
      {selectedMember && (
        <MemberModal
          mode="edit"
          open={true}
          onClose={() => setSelectedMember(null)}
          member={selectedMember}
          onUpdated={(updated) => {
            upsertMember({
              ...updated,
              workspaceRole: updated.workspaceRole ?? "member",
              status: updated.status ?? "active",
            });
            setSelectedMember(null);
          }}
          onRemoved={(memberId) => {
            removeMemberFromCache(memberId);
            setSelectedMember(null);
          }}
        />
      )}
    </div>
  );
}
