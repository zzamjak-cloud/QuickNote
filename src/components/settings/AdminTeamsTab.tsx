import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { archiveTeamApi, createTeamApi, deleteTeamApi, restoreTeamApi, updateTeamApi } from "../../lib/sync/teamApi";
import { useTeamStore } from "../../store/teamStore";
import { useMemberStore } from "../../store/memberStore";
import { assignMemberToTeamApi, unassignMemberFromTeamApi } from "../../lib/sync/memberApi";

type TabType = "active" | "archived";

export function AdminTeamsTab() {
  const teams = useTeamStore((s) => s.teams);
  const members = useMemberStore((s) => s.members);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [openAssignTeamId, setOpenAssignTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archivedActionId, setArchivedActionId] = useState<string | null>(null);
  const [archivedActionLoading, setArchivedActionLoading] = useState(false);

  // 활성/보관 팀 분류 + 이름 알파벳/가나다 정렬
  const activeTeams = useMemo(
    () =>
      teams
        .filter((t) => !t.removedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [teams],
  );
  const archivedTeams = useMemo(
    () =>
      teams
        .filter((t) => !!t.removedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [teams],
  );

  const assignTeam = useMemo(
    () => teams.find((t) => t.teamId === openAssignTeamId) ?? null,
    [teams, openAssignTeamId],
  );

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selected = new Set(selectedMemberIds);
    const pool = members.filter((m) => !selected.has(m.memberId));
    if (!q) return pool;
    return pool.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.jobRole.toLowerCase().includes(q),
    );
  }, [members, search, selectedMemberIds]);

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.memberId, m])),
    [members],
  );

  const onCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    const created = await createTeamApi(name);
    upsertTeam(created);
    setNewTeamName("");
    setOpenCreate(false);
  };

  // 보관함으로 이동 (assign 모달 내에서 호출)
  const onArchiveTeam = async (teamId: string) => {
    const archived = await archiveTeamApi(teamId);
    if (archived) {
      upsertTeam(archived);
      if (openAssignTeamId === teamId) setOpenAssignTeamId(null);
    }
  };

  // 보관 팀 복원 (클릭 즉시)
  const onRestoreTeam = async (teamId: string) => {
    const restored = await restoreTeamApi(teamId);
    if (restored) upsertTeam(restored);
  };

  const onOpenAssignModal = (teamId: string) => {
    const team = teams.find((t) => t.teamId === teamId);
    setOpenAssignTeamId(teamId);
    setEditingTeamName(team?.name ?? "");
    setSearch("");
    setSelectedMemberIds(team?.members.map((m) => m.memberId) ?? []);
  };

  const onToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  const onSaveMembers = async () => {
    if (!assignTeam) return;
    setSaving(true);
    try {
      const newName = editingTeamName.trim();
      const prevIds = new Set(assignTeam.members.map((m) => m.memberId));
      const nextIds = new Set(selectedMemberIds);
      const addIds = selectedMemberIds.filter((id) => !prevIds.has(id));
      const removeIds = assignTeam.members.map((m) => m.memberId).filter((id) => !nextIds.has(id));
      const [updatedTeam] = await Promise.all([
        newName && newName !== assignTeam.name
          ? updateTeamApi(assignTeam.teamId, newName)
          : Promise.resolve(null),
        ...addIds.map((memberId) => assignMemberToTeamApi(memberId, assignTeam.teamId)),
        ...removeIds.map((memberId) => unassignMemberFromTeamApi(memberId, assignTeam.teamId)),
      ]);
      const nextMembers = selectedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertTeam({ ...assignTeam, ...(updatedTeam ?? {}), members: nextMembers });
      setOpenAssignTeamId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">팀 관리</h3>
        {activeTab === "active" && (
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Plus size={12} />
            팀 추가
          </button>
        )}
      </div>

      {/* 팀 / 보관함 탭 */}
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
          팀
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

      {activeTab === "active" ? (
        /* 활성 팀 목록 */
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
            팀 목록
          </div>
          <ul className="grid grid-cols-1 gap-2 p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
            {activeTeams.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                등록된 팀이 없습니다.
              </li>
            ) : (
              activeTeams.map((team) => (
                <li key={team.teamId}>
                  <button
                    type="button"
                    aria-label={`${team.name} 구성원 관리`}
                    onClick={() => onOpenAssignModal(team.teamId)}
                    className="flex w-full items-center justify-between rounded border border-blue-200 bg-blue-50 px-3 py-2 text-left text-blue-950 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-blue-100 dark:hover:bg-blue-950/55"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {team.name} ({team.members.length}명)
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        /* 보관된 팀 목록 */
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
            보관된 팀
          </div>
          <ul className="grid grid-cols-1 gap-2 p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
            {archivedTeams.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                보관된 팀 없음
              </li>
            ) : (
              archivedTeams.map((team) => (
                <li key={team.teamId}>
                  <button
                    type="button"
                    aria-label={`${team.name} 관리`}
                    onClick={() => setArchivedActionId(team.teamId)}
                    className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                      {team.name}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {/* 보관된 팀 액션 팝업 */}
      {archivedActionId && (() => {
        const team = archivedTeams.find((t) => t.teamId === archivedActionId);
        if (!team) return null;
        return (
          <div
            className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setArchivedActionId(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h4 className="text-sm font-semibold">{team.name}</h4>
              <p className="mt-1 text-xs text-zinc-500">보관된 팀입니다.</p>
              <div className="mt-4 flex justify-between gap-2">
                <button
                  type="button"
                  disabled={archivedActionLoading}
                  onClick={async () => {
                    setArchivedActionLoading(true);
                    try {
                      await deleteTeamApi(team.teamId);
                      const current = useTeamStore.getState().teams.filter(
                        (t) => t.teamId !== team.teamId,
                      );
                      useTeamStore.setState({ teams: current });
                      setArchivedActionId(null);
                    } catch {
                      // 실패 시 조용히 처리
                    } finally {
                      setArchivedActionLoading(false);
                    }
                  }}
                  className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  팀 영구 삭제
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setArchivedActionId(null)}
                    disabled={archivedActionLoading}
                    className="rounded border px-3 py-1 text-xs disabled:opacity-60"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    disabled={archivedActionLoading}
                    onClick={async () => {
                      setArchivedActionLoading(true);
                      try {
                        await onRestoreTeam(team.teamId);
                        setArchivedActionId(null);
                      } finally {
                        setArchivedActionLoading(false);
                      }
                    }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-60 hover:bg-blue-700"
                  >
                    복원
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 팀 추가 모달 */}
      {openCreate && (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setOpenCreate(false);
              setNewTeamName("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold">새 팀 추가</h4>
            <input
              autoFocus
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onCreateTeam()}
              placeholder="팀 이름"
              className="mt-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOpenCreate(false); setNewTeamName(""); }}
                className="rounded border px-3 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onCreateTeam()}
                className="rounded bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 팀 구성원 관리 모달 */}
      {openAssignTeamId && assignTeam ? (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenAssignTeamId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-4xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <input
                value={editingTeamName}
                onChange={(e) => setEditingTeamName(e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm font-semibold outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
              />
              <span className="shrink-0 text-xs text-zinc-400">구성원 관리</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <section className="min-h-72 rounded-md border border-zinc-200 dark:border-zinc-700">
                <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
                  등록된 구성원
                </div>
                <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
                  {selectedMemberIds.map((memberId) => {
                    const m = membersById.get(memberId);
                    if (!m) return null;
                    return (
                      <li key={memberId} className="flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-blue-100">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="block truncate text-zinc-500">{m.email} · {m.jobRole}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleMember(memberId)}
                          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          aria-label={`${m.name} 제외`}
                        >
                          <X size={13} />
                        </button>
                      </li>
                    );
                  })}
                  {selectedMemberIds.length === 0 ? (
                    <li className="rounded border border-dashed border-zinc-300 px-2 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
                      등록된 구성원이 없습니다.
                    </li>
                  ) : null}
                </ul>
              </section>
              <section className="min-h-72 rounded-md border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <Search size={13} className="text-zinc-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="전체 구성원 검색"
                    className="w-full bg-transparent text-xs outline-none"
                  />
                </div>
                <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
                  {filteredMembers.map((m) => (
                    <li key={m.memberId}>
                      <button
                        type="button"
                        onClick={() => onToggleMember(m.memberId)}
                        className="flex w-full items-start gap-2 rounded border border-zinc-200 px-2 py-1.5 text-left text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <span>
                          <span className="block font-medium">{m.name}</span>
                          <span className="block text-zinc-500">{m.email} · {m.jobRole}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {filteredMembers.length === 0 ? (
                    <li className="rounded border border-dashed border-zinc-300 px-2 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
                      추가할 구성원이 없습니다.
                    </li>
                  ) : null}
                </ul>
              </section>
            </div>
            <div className="mt-4 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => void onArchiveTeam(assignTeam.teamId)}
                className="rounded border border-amber-200 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                disabled={saving}
              >
                보관함으로 이동
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenAssignTeamId(null)}
                  className="rounded border px-3 py-1 text-xs"
                  disabled={saving}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void onSaveMembers()}
                  disabled={saving}
                  className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
