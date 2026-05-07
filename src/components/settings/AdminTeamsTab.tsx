import { useMemo, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { createTeamApi, deleteTeamApi } from "../../lib/sync/teamApi";
import { useTeamStore } from "../../store/teamStore";
import { useMemberStore } from "../../store/memberStore";
import { assignMemberToTeamApi, unassignMemberFromTeamApi } from "../../lib/sync/memberApi";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

export function AdminTeamsTab() {
  const teams = useTeamStore((s) => s.teams);
  const members = useMemberStore((s) => s.members);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const removeTeam = useTeamStore((s) => s.removeTeam);
  const [openCreate, setOpenCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);
  const [openAssignTeamId, setOpenAssignTeamId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const assignTeam = useMemo(
    () => teams.find((t) => t.teamId === openAssignTeamId) ?? null,
    [teams, openAssignTeamId],
  );
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.jobRole.toLowerCase().includes(q),
    );
  }, [members, search]);

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

  const onDeleteTeam = async () => {
    if (!confirmDeleteTeamId) return;
    const ok = await deleteTeamApi(confirmDeleteTeamId);
    if (ok) {
      removeTeam(confirmDeleteTeamId);
      if (openAssignTeamId === confirmDeleteTeamId) {
        setOpenAssignTeamId(null);
      }
    }
    setConfirmDeleteTeamId(null);
  };

  const onOpenAssignModal = (teamId: string) => {
    const team = teams.find((t) => t.teamId === teamId);
    setOpenAssignTeamId(teamId);
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
      const prevIds = new Set(assignTeam.members.map((m) => m.memberId));
      const nextIds = new Set(selectedMemberIds);
      const addIds = selectedMemberIds.filter((id) => !prevIds.has(id));
      const removeIds = assignTeam.members.map((m) => m.memberId).filter((id) => !nextIds.has(id));
      await Promise.all([
        ...addIds.map((memberId) => assignMemberToTeamApi(memberId, assignTeam.teamId)),
        ...removeIds.map((memberId) => unassignMemberFromTeamApi(memberId, assignTeam.teamId)),
      ]);
      const nextMembers = selectedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertTeam({ ...assignTeam, members: nextMembers });
      setOpenAssignTeamId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">팀 관리</h3>
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <Plus size={12} />
          팀 추가
        </button>
      </div>

      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
          팀 목록
        </div>
        <ul className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
          {teams.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              등록된 팀이 없습니다.
            </li>
          ) : (
            teams.map((team) => (
              <li
                key={team.teamId}
                className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <span className="min-w-0 flex-1 truncate">
                  {team.name} ({team.members.length}명)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenAssignModal(team.teamId)}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label={`${team.name} 구성원 관리`}
                    title="구성원 관리"
                  >
                    <Users size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTeamId(team.teamId)}
                    className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    aria-label={`${team.name} 삭제`}
                    title="삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <SimpleConfirmDialog
        open={confirmDeleteTeamId !== null}
        title="팀 삭제"
        message="이 팀을 삭제하시겠습니까?"
        confirmLabel="삭제"
        cancelLabel="취소"
        danger
        onCancel={() => setConfirmDeleteTeamId(null)}
        onConfirm={() => void onDeleteTeam()}
      />

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
            className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold">{assignTeam.name} 구성원 관리</h4>
            <div className="mt-3 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름/이메일/직무 검색 (부분 일치)"
                className="w-full bg-transparent text-xs outline-none"
              />
            </div>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {filteredMembers.map((m) => {
                const checked = selectedMemberIds.includes(m.memberId);
                return (
                  <li key={m.memberId}>
                    <label className="flex cursor-pointer items-start gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleMember(m.memberId)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium">{m.name}</span>
                        <span className="block text-zinc-500">
                          {m.email} · {m.jobRole}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {filteredMembers.length === 0 ? (
                <li className="rounded border border-dashed border-zinc-300 px-2 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  검색 결과가 없습니다.
                </li>
              ) : null}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
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
      ) : null}
    </div>
  );
}
