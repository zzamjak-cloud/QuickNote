import { useCallback, useMemo, useState } from "react";
import { Plus, Search, Trash2, Upload, X } from "lucide-react";
import { createMemberApi, deleteMemberApi } from "../../lib/sync/memberApi";
import { useMemberStore, type Member } from "../../store/memberStore";
import { useTeamStore } from "../../store/teamStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { CreateMemberModal } from "./CreateMemberModal";
import { MemberModal } from "./MemberModal";
import { CsvImportModal } from "./CsvImportModal";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { isBulkRemovable, useBulkRemoveMembers } from "./useBulkRemoveMembers";
import { runSequentially, useBulkSelection } from "./useBulkSelection";

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
  const organizations = useOrganizationStore((s) => s.organizations);
  const upsertMember = useMemberStore((s) => s.upsertMember);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const upsertOrganization = useOrganizationStore((s) => s.upsertOrganization);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [openCsvImport, setOpenCsvImport] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [archivedMember, setArchivedMember] = useState<Member | null>(null);
  const meId = useMemberStore((s) => s.me?.memberId);
  const removeMemberFromCache = useMemberStore((s) => s.removeMemberFromCache);
  const [bulkConfirm, setBulkConfirm] = useState<"remove" | "delete" | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { removeMembers, running: bulkRunning } = useBulkRemoveMembers();

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
  const applyFilter = useCallback((list: Member[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const teamInfo = (teamNamesByMemberId.get(m.memberId) ?? []).join(" ").toLowerCase();
      return (
        (m.name ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q) ||
        (m.jobRole ?? "").toLowerCase().includes(q) ||
        teamInfo.includes(q)
      );
    });
  }, [query, teamNamesByMemberId]);

  // 이름 알파벳/가나다 정렬 적용
  const activeMembers = useMemo(
    () =>
      applyFilter(members.filter((m) => m.status === "active"))
        .slice()
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko")),
    [members, applyFilter],
  );

  const archivedMembers = useMemo(
    () =>
      applyFilter(members.filter((m) => m.status === "removed"))
        .slice()
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko")),
    [members, applyFilter],
  );

  const detachMemberFromGroupsInStore = useCallback((memberId: string) => {
    for (const team of teams) {
      const hasMember = team.members.some((member) => member.memberId === memberId);
      const hasLeader = (team.leaderMemberIds ?? []).includes(memberId);
      if (!hasMember && !hasLeader) continue;
      upsertTeam({
        ...team,
        members: team.members.filter((member) => member.memberId !== memberId),
        leaderMemberIds: (team.leaderMemberIds ?? []).filter((leaderId) => leaderId !== memberId),
      });
    }

    for (const organization of organizations) {
      const hasMember = organization.members.some((member) => member.memberId === memberId);
      const hasLeader = (organization.leaderMemberIds ?? []).includes(memberId);
      if (!hasMember && !hasLeader) continue;
      upsertOrganization({
        ...organization,
        members: organization.members.filter((member) => member.memberId !== memberId),
        leaderMemberIds: (organization.leaderMemberIds ?? []).filter(
          (leaderId) => leaderId !== memberId,
        ),
      });
    }
  }, [organizations, teams, upsertOrganization, upsertTeam]);

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
  const isActiveTab = activeTab === "active";

  // 선택 가능 id 만 넘겨, 검색으로 가려졌거나 보호 대상인 구성원은 일괄 작업에서 빠지게 한다.
  const activeSelectableIds = useMemo(
    () => activeMembers.filter((m) => isBulkRemovable(m, meId)).map((m) => m.memberId),
    [activeMembers, meId],
  );
  const archivedSelectableIds = useMemo(
    () => archivedMembers.filter((m) => isBulkRemovable(m, meId)).map((m) => m.memberId),
    [archivedMembers, meId],
  );
  const activeSelection = useBulkSelection(activeSelectableIds);
  const archivedSelection = useBulkSelection(archivedSelectableIds);
  const tabSelection = isActiveTab ? activeSelection : archivedSelection;
  const tabSelectableCount = isActiveTab ? activeSelectableIds.length : archivedSelectableIds.length;
  const tabAllChecked = tabSelectableCount > 0 && tabSelection.selectedIds.length === tabSelectableCount;
  const busy = bulkRunning || bulkDeleting;

  const membersById = useMemo(() => new Map(members.map((m) => [m.memberId, m])), [members]);
  const nameOf = (id: string) => membersById.get(id)?.name || membersById.get(id)?.email || id;

  const runBulkRemove = async () => {
    setBulkError(null);
    const targets = activeMembers.filter((m) => activeSelection.selectedIds.includes(m.memberId));
    const { removed, failed } = await removeMembers(targets);
    for (const member of removed) {
      detachMemberFromGroupsInStore(member.memberId);
      upsertMember(member);
    }
    activeSelection.reset(failed.map((m) => m.memberId));
    if (failed.length > 0) {
      setBulkError(`${failed.length}명 제거 실패: ${failed.map((m) => m.name || m.email).join(", ")}`);
    }
  };

  const runBulkDelete = async () => {
    setBulkError(null);
    setBulkDeleting(true);
    try {
      const { failedIds } = await runSequentially(
        archivedSelection.selectedIds,
        async (id) => {
          // false 는 서버에 이미 없다는 뜻이므로 실패가 아니라 캐시 정리 대상
          await deleteMemberApi(id);
          removeMemberFromCache(id);
        },
        "AdminMembersTab",
      );
      archivedSelection.reset(failedIds);
      if (failedIds.length > 0) {
        setBulkError(`${failedIds.length}명 영구 삭제 실패: ${failedIds.map(nameOf).join(", ")}`);
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  const onConfirmBulk = () => {
    const mode = bulkConfirm;
    setBulkConfirm(null);
    if (mode === "remove") void runBulkRemove();
    else if (mode === "delete") void runBulkDelete();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1.5">
          {tabSelection.selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setBulkConfirm(isActiveTab ? "remove" : "delete")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Trash2 size={13} />
              {busy
                ? "처리 중…"
                : `${isActiveTab ? "선택 제거" : "선택 영구 삭제"} (${tabSelection.selectedIds.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpenCsvImport(true)}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            <Upload size={13} />
            CSV 가져오기
          </button>
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            <Plus size={13} />
            구성원 추가
          </button>
      </div>

      {/* 구성원 / 보관함 탭 + 검색 */}
      <div className="flex h-9 items-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => {
            setActiveTab("active");
            setQuery("");
            activeSelection.reset();
            archivedSelection.reset();
          }}
          className={`h-9 px-3 text-sm font-medium transition-colors ${
            activeTab === "active"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          구성원
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("archived");
            setQuery("");
            activeSelection.reset();
            archivedSelection.reset();
            setBulkError(null);
          }}
          className={`h-9 px-3 text-sm font-medium transition-colors ${
            activeTab === "archived"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          보관함
        </button>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
          <Search size={13} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름/이메일/직무 검색"
            className="w-40 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            type="button"
            onClick={() => setQuery("")}
            className={`rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${
              query ? "" : "pointer-events-none opacity-0"
            }`}
            aria-label="검색어 전체 삭제"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {bulkError && <p className="text-xs text-red-500">{bulkError}</p>}

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="구성원 전체 선택"
                  checked={tabAllChecked}
                  disabled={tabSelectableCount === 0 || busy}
                  onChange={tabSelection.toggleAll}
                />
              </th>
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
                <td colSpan={6} className="px-3 py-4 text-zinc-500">
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
                  <td className="w-8 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`${m.name} 선택`}
                      checked={tabSelection.isSelected(m.memberId)}
                      disabled={!isBulkRemovable(m, meId) || busy}
                      onChange={() => tabSelection.toggle(m.memberId)}
                    />
                  </td>
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

      <SimpleConfirmDialog
        open={bulkConfirm !== null}
        zIndex={540}
        title={bulkConfirm === "delete" ? "구성원 영구 삭제" : "구성원 일괄 제거"}
        message={
          bulkConfirm === "delete"
            ? `선택한 ${archivedSelection.selectedIds.length}명을 영구 삭제합니다. 되돌릴 수 없으며, 같은 이메일로 다시 등록할 수 있게 됩니다. 개인 노트 등 작성한 콘텐츠는 유지됩니다.`
            : `선택한 ${activeSelection.selectedIds.length}명을 보관함으로 이동합니다. 팀·조직에서도 분리됩니다. 계속할까요?`
        }
        confirmLabel={bulkConfirm === "delete" ? "영구 삭제" : "제거"}
        danger
        onCancel={() => setBulkConfirm(null)}
        onConfirm={onConfirmBulk}
      />

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
          onRemoved={(member) => {
            detachMemberFromGroupsInStore(member.memberId);
            upsertMember({
              ...member,
              workspaceRole: member.workspaceRole ?? "member",
              status: member.status ?? "removed",
            });
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
          onRemoved={(member) => {
            detachMemberFromGroupsInStore(member.memberId);
            upsertMember({
              ...member,
              workspaceRole: member.workspaceRole ?? "member",
              status: member.status ?? "removed",
            });
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
