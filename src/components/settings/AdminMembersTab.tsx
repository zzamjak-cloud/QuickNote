import { useMemo, useState } from "react";
import { Plus, Search, Upload } from "lucide-react";
import { createMemberApi } from "../../lib/sync/memberApi";
import { useMemberStore, type Member } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import { CreateMemberModal } from "./CreateMemberModal";
import { MemberModal } from "./MemberModal";
import { CsvImportModal } from "./CsvImportModal";

/** 역할 표시 문자열 반환 */
function toUpperRole(role: Member["workspaceRole"]): string {
  const map: Record<Member["workspaceRole"], string> = {
    developer: "Developer",
    owner: "Owner",
    leader: "Leader",
    manager: "Manager",
    member: "Member",
  };
  return map[role] ?? role;
}

type TabType = "active" | "archived";

export function AdminMembersTab() {
  const members = useMemberStore((s) => s.members);
  const teams = useTeamStore((s) => s.teams);
  const upsertMember = useMemberStore((s) => s.upsertMember);
  const removeMemberFromCache = useMemberStore((s) => s.removeMemberFromCache);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [openCsvImport, setOpenCsvImport] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [archivedMember, setArchivedMember] = useState<Member | null>(null);

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

  /** 검색 필터 적용 */
  const applyFilter = (list: Member[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const teamInfo = (teamNamesByMemberId.get(m.memberId) ?? []).join(" ").toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.jobRole.toLowerCase().includes(q) ||
        teamInfo.includes(q)
      );
    });
  };

  const activeMembers = useMemo(
    () => applyFilter(members.filter((m) => m.status === "active")),
    [members, query, teamNamesByMemberId],
  );

  const archivedMembers = useMemo(
    () => applyFilter(members.filter((m) => m.status === "removed")),
    [members, query, teamNamesByMemberId],
  );

  const onCreate = async (input: { email: string; name: string; jobRole: string; workspaceRole: string }) => {
    const { workspaceRole, ...rest } = input;
    const created = await createMemberApi({
      ...rest,
      workspaceRole: workspaceRole.toUpperCase() as "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER",
    });
    upsertMember({
      ...created,
      workspaceRole: created.workspaceRole ?? "member",
      status: created.status ?? "active",
    });
  };

  const displayList = activeTab === "active" ? activeMembers : archivedMembers;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">구성원 관리</h3>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setOpenCsvImport(true)}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Upload size={12} />
            CSV 가져오기
          </button>
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Plus size={12} />
            구성원 추가
          </button>
        </div>
      </div>

      {/* 구성원 / 보관함 탭 */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setActiveTab("active")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "active"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          구성원
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("archived")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "archived"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          보관함
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
            </tr>
          </thead>
          <tbody>
            {displayList.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-zinc-500">
                  결과가 없습니다.
                </td>
              </tr>
            ) : (
              displayList.map((m) => (
                <tr
                  key={m.memberId}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                  onClick={() => {
                    if (activeTab === "active") {
                      setSelectedMember(m);
                    } else {
                      setArchivedMember(m);
                    }
                  }}
                >
                  <td className="whitespace-nowrap px-3 py-2">{m.name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{m.email}</td>
                  <td className="whitespace-nowrap px-3 py-2">{m.jobRole}</td>
                  <td className="whitespace-nowrap px-3 py-2">{toUpperRole(m.workspaceRole)}</td>
                  <td className="min-w-[220px] px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {teamNamesByMemberId.get(m.memberId)?.join(", ") || "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CsvImportModal
        open={openCsvImport}
        onClose={() => setOpenCsvImport(false)}
      />

      <CreateMemberModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreate={onCreate}
      />

      {/* 구성원 탭 편집 모달 */}
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

      {/* 보관함 탭 편집 모달 */}
      {archivedMember && (
        <MemberModal
          mode="edit"
          open={true}
          onClose={() => setArchivedMember(null)}
          member={archivedMember}
          archived={true}
          onUpdated={(updated) => {
            upsertMember({
              ...updated,
              workspaceRole: updated.workspaceRole ?? "member",
              status: updated.status ?? "active",
            });
            setArchivedMember(null);
          }}
          onRemoved={(memberId) => {
            removeMemberFromCache(memberId);
            setArchivedMember(null);
          }}
          onRestored={(member) => {
            upsertMember(member);
            setArchivedMember(null);
          }}
        />
      )}
    </div>
  );
}
