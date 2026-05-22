// 팀 관리 탭

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  archiveTeamApi,
  createTeamApi,
  deleteTeamApi,
  restoreTeamApi,
  updateTeamApi,
} from "../../lib/sync/teamApi";
import { useTeamStore } from "../../store/teamStore";
import { useMemberStore } from "../../store/memberStore";
import { assignMemberToTeamApi, unassignMemberFromTeamApi } from "../../lib/sync/memberApi";
import { inferLeaderMemberIds } from "../../lib/scheduler/mm/leaderDefaults";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { sortByKoreanName } from "../../lib/memberSearch";
import { AdminListHeader } from "./AdminListHeader";
import { EntityCard } from "../common/EntityCard";
import { EntityEditModal } from "../common/EntityEditModal";

type TabType = "active" | "archived";

export function AdminTeamsTab() {
  const teams = useTeamStore((s) => s.teams);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const removeTeam = useTeamStore((s) => s.removeTeam);
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const entityIcons = useSettingsStore((s) => s.entityIcons);
  const setEntityIcon = useSettingsStore((s) => s.setEntityIcon);
  const entityDescriptions = useSettingsStore((s) => s.entityDescriptions);
  const setEntityDescription = useSettingsStore((s) => s.setEntityDescription);

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [openAssignTeamId, setOpenAssignTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>([]);
  const selectedLeaderIdsRef = useRef<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [singleDeleting, setSingleDeleting] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const activeTeams = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return teams
      .filter((t) => !t.removedAt)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [teams, listQuery]);

  const archivedTeams = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return teams
      .filter((t) => !!t.removedAt)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [teams, listQuery]);

  const assignTeam = useMemo(
    () => teams.find((t) => t.teamId === openAssignTeamId) ?? null,
    [teams, openAssignTeamId],
  );

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.memberId, m])),
    [members],
  );

  const selectedMembers = useMemo(
    () =>
      sortByKoreanName(
        selectedMemberIds
          .map((id) => membersById.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m)),
      ),
    [membersById, selectedMemberIds],
  );

  const setLeaderSelection = (nextIds: string[]) => {
    selectedLeaderIdsRef.current = nextIds;
    setSelectedLeaderIds(nextIds);
  };

  const formatLeaderNames = (leaderMemberIds: string[]) => {
    if (leaderMemberIds.length === 0) return "-";
    const names = leaderMemberIds
      .map((id) => membersById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    return names.length === 0 ? "-" : names.join(", ");
  };

  const buildLeaderSavedMessage = (leaderIds: string[]) => {
    const names = leaderIds
      .map((id) => membersById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    if (names.length === 0) return "팀 리더 설정이 저장되었습니다.";
    if (names.length === 1 && names[0]) return `${names[0]}님이 리더로 등록되었습니다.`;
    if (names[0]) return `${names[0]}님 외 ${names.length - 1}명이 리더로 등록되었습니다.`;
    return "팀 리더 설정이 저장되었습니다.";
  };

  const onCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    const created = await createTeamApi(name);
    upsertTeam(created);
    setNewTeamName("");
    setOpenCreate(false);
  };

  const onOpenAssignModal = (teamId: string) => {
    const team = teams.find((t) => t.teamId === teamId);
    setOpenAssignTeamId(teamId);
    setEditingTeamName(team?.name ?? "");
    setEditingDescription(entityDescriptions[teamId] ?? "");
    setSelectedMemberIds(team?.members.map((m) => m.memberId) ?? []);
    const initial =
      (team?.leaderMemberIds?.length
        ? team.leaderMemberIds
        : inferLeaderMemberIds("team", team?.members ?? [])) ?? [];
    setLeaderSelection(initial);
  };

  const updateSelectedMembers = (nextIds: string[]) => {
    setSelectedMemberIds((prev) => {
      const normalized = Array.from(new Set(nextIds));
      const next =
        normalized.length === prev.length && normalized.every((id, i) => id === prev[i])
          ? prev
          : normalized;
      setLeaderSelection(selectedLeaderIdsRef.current.filter((id) => next.includes(id)));
      return next;
    });
  };

  const addMember = (memberId: string) =>
    updateSelectedMembers(
      selectedMemberIds.includes(memberId)
        ? selectedMemberIds
        : [...selectedMemberIds, memberId],
    );
  const removeMember = (memberId: string) =>
    updateSelectedMembers(selectedMemberIds.filter((id) => id !== memberId));
  const toggleLeader = (memberId: string) => {
    const next = selectedLeaderIdsRef.current.includes(memberId)
      ? selectedLeaderIdsRef.current.filter((id) => id !== memberId)
      : [...selectedLeaderIdsRef.current, memberId];
    setLeaderSelection(next);
  };

  const onSaveMembers = async () => {
    if (!assignTeam) return;
    setSaving(true);
    try {
      const newName = editingTeamName.trim();
      const prevIds = new Set(assignTeam.members.map((m) => m.memberId));
      const nextIds = new Set(selectedMemberIds);
      const addIds = selectedMemberIds.filter((id) => !prevIds.has(id));
      const removeIds = assignTeam.members
        .map((m) => m.memberId)
        .filter((id) => !nextIds.has(id));
      const currentLeaderIds = selectedLeaderIdsRef.current;
      const nextLeaderIds = currentLeaderIds.filter((id) => nextIds.has(id));
      const prevLeaders = assignTeam.leaderMemberIds ?? [];
      const leaderChanged =
        prevLeaders.length !== nextLeaderIds.length ||
        prevLeaders.some((id) => !nextLeaderIds.includes(id));
      const updatedTeam = await (newName !== assignTeam.name || leaderChanged
        ? updateTeamApi(
            assignTeam.teamId,
            newName || assignTeam.name,
            leaderChanged ? nextLeaderIds : undefined,
          )
        : Promise.resolve(null));
      await Promise.all([
        ...addIds.map((id) => assignMemberToTeamApi(id, assignTeam.teamId)),
        ...removeIds.map((id) => unassignMemberFromTeamApi(id, assignTeam.teamId)),
      ]);
      const nextMembers = selectedMemberIds
        .map((id) => membersById.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertTeam({
        ...assignTeam,
        ...(updatedTeam ?? {}),
        name: newName || assignTeam.name,
        leaderMemberIds: nextLeaderIds,
        members: nextMembers,
      });
      setEntityDescription(assignTeam.teamId, editingDescription);
      showToast(buildLeaderSavedMessage(nextLeaderIds), { kind: "success" });
      setOpenAssignTeamId(null);
    } catch (error) {
      console.error("[AdminTeams] 저장 실패", error);
      showToast("팀 저장에 실패했습니다.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const onArchiveTeam = async (teamId: string) => {
    try {
      const archived = await archiveTeamApi(teamId);
      if (archived) {
        upsertTeam(archived);
        if (openAssignTeamId === teamId) setOpenAssignTeamId(null);
      }
    } catch (err) {
      console.error("[AdminTeams] 보관함 이동 실패", teamId, err);
      alert("보관함 이동 실패. 콘솔을 확인해주세요.");
    }
  };

  const onRestoreTeam = async (teamId: string) => {
    try {
      const restored = await restoreTeamApi(teamId);
      if (restored) upsertTeam(restored);
    } catch (err) {
      console.error("[AdminTeams] 복원 실패", teamId, err);
      alert("복원 실패. 콘솔을 확인해주세요.");
    }
  };

  const onPermanentDeleteTeam = async (teamId: string) => {
    setSingleDeleting(true);
    try {
      const ok = await deleteTeamApi(teamId);
      if (ok) {
        removeTeam(teamId);
        setDeleteConfirmId(null);
      } else {
        alert("삭제 실패: 서버에서 팀을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("[AdminTeams] 영구 삭제 실패", teamId, err);
      alert("삭제 실패: 권한 또는 네트워크 문제일 수 있습니다. 콘솔을 확인해주세요.");
    } finally {
      setSingleDeleting(false);
    }
  };

  const onBulkPermanentDelete = async () => {
    if (bulkSelectedIds.size === 0) return;
    setBulkDeleting(true);
    let okCount = 0;
    let failCount = 0;
    try {
      const ids = Array.from(bulkSelectedIds);
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const ok = await deleteTeamApi(id);
            return { id, ok };
          } catch (err) {
            console.error("[AdminTeams] 영구 삭제 실패", id, err);
            return { id, ok: false };
          }
        }),
      );
      for (const r of results) {
        if (r.ok) {
          okCount++;
          removeTeam(r.id);
        } else {
          failCount++;
        }
      }
      setBulkSelectedIds(new Set());
      setBulkConfirmOpen(false);
      if (failCount > 0)
        alert(`삭제 완료 ${okCount}개, 실패 ${failCount}개. 콘솔을 확인해주세요.`);
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleBulkSelect = (teamId: string) =>
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });

  const toggleSelectAll = () => {
    if (bulkSelectedIds.size === archivedTeams.length) {
      setBulkSelectedIds(new Set());
    } else {
      setBulkSelectedIds(new Set(archivedTeams.map((t) => t.teamId)));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex h-9 items-center justify-end">
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          style={{ visibility: activeTab === "active" ? "visible" : "hidden" }}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          <Plus size={13} />
          팀 추가
        </button>
      </div>

      <AdminListHeader
        leftLabel="팀"
        activeTab={activeTab}
        query={listQuery}
        queryPlaceholder="팀 검색"
        onChangeTab={setActiveTab}
        onChangeQuery={setListQuery}
      />

      {activeTab === "active" ? (
        <ul className="grid grid-cols-1 gap-2 text-sm">
          {activeTeams.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              등록된 팀이 없습니다.
            </li>
          ) : (
            activeTeams.map((team) => (
              <li key={team.teamId}>
                <EntityCard
                  icon={entityIcons[team.teamId] ?? null}
                  name={team.name}
                  memberCount={team.members.length}
                  leaderLabel={formatLeaderNames(team.leaderMemberIds ?? [])}
                  hasLeaders={(team.leaderMemberIds?.length ?? 0) > 0}
                  onClick={() => onOpenAssignModal(team.teamId)}
                />
              </li>
            ))
          )}
        </ul>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {archivedTeams.length > 0 && (
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={bulkSelectedIds.size === archivedTeams.length}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        bulkSelectedIds.size > 0 &&
                        bulkSelectedIds.size < archivedTeams.length;
                    }
                  }}
                  onChange={toggleSelectAll}
                />
              )}
              {bulkSelectedIds.size > 0 && (
                <span className="text-zinc-500">{bulkSelectedIds.size}개 선택</span>
              )}
            </div>
            {bulkSelectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(true)}
                disabled={bulkDeleting}
                className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                선택한 {bulkSelectedIds.size}개 영구 삭제
              </button>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-2 text-sm">
            {archivedTeams.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                보관된 팀 없음
              </li>
            ) : (
              archivedTeams.map((team) => (
                <li key={team.teamId}>
                  <div className="flex items-center gap-2 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <input
                      type="checkbox"
                      aria-label={`${team.name} 선택`}
                      checked={bulkSelectedIds.has(team.teamId)}
                      onChange={() => toggleBulkSelect(team.teamId)}
                    />
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(team.teamId)}
                      className="min-w-0 flex-1 truncate text-left text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                    >
                      {team.name}
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {/* 보관된 팀 액션 팝업 */}
      {deleteConfirmId &&
        (() => {
          const team = archivedTeams.find((t) => t.teamId === deleteConfirmId);
          if (!team) return null;
          return (
            <div
              className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setDeleteConfirmId(null);
              }}
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
                    disabled={singleDeleting}
                    onClick={() => void onPermanentDeleteTeam(team.teamId)}
                    className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    {singleDeleting ? "삭제 중..." : "팀 영구 삭제"}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={singleDeleting}
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded border px-3 py-1 text-xs disabled:opacity-60"
                    >
                      닫기
                    </button>
                    <button
                      type="button"
                      disabled={singleDeleting}
                      onClick={() => {
                        void onRestoreTeam(team.teamId);
                        setDeleteConfirmId(null);
                      }}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-60"
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
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateTeam();
              }}
              placeholder="팀 이름"
              className="mt-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenCreate(false);
                  setNewTeamName("");
                }}
                className="rounded border px-3 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onCreateTeam()}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 팀 편집 모달 */}
      {openAssignTeamId && assignTeam && (
        <EntityEditModal
          name={editingTeamName}
          onNameChange={setEditingTeamName}
          icon={entityIcons[openAssignTeamId] ?? null}
          onIconChange={(icon) => setEntityIcon(openAssignTeamId, icon)}
          description={editingDescription}
          onDescriptionChange={setEditingDescription}
          descriptionPlaceholder="팀 소개"
          selectedMembers={selectedMembers}
          allMembers={members}
          leaderMemberIds={selectedLeaderIds}
          onToggleLeader={toggleLeader}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onSave={onSaveMembers}
          onArchive={() => onArchiveTeam(assignTeam.teamId)}
          onCancel={() => setOpenAssignTeamId(null)}
          saving={saving}
        />
      )}

      {/* 일괄 영구 삭제 확인 */}
      {bulkConfirmOpen && (
        <div
          className="fixed inset-0 z-[540] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !bulkDeleting) setBulkConfirmOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold">
              선택한 {bulkSelectedIds.size}개 팀 영구 삭제
            </h4>
            <p className="mt-2 text-xs text-zinc-500">
              이 작업은 되돌릴 수 없습니다. DB에서 완전히 제거되며 멤버 배정도 함께 해제됩니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkDeleting}
                className="rounded border px-3 py-1 text-xs disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onBulkPermanentDelete()}
                disabled={bulkDeleting}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-60"
              >
                {bulkDeleting ? "삭제 중..." : "영구 삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
