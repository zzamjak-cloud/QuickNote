import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Crown, Plus, Search } from "lucide-react";
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
import { useMemberSuggestionDropdown } from "../../hooks/useMemberSuggestionDropdown";
import { IconPicker } from "../common/IconPicker";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { sortByKoreanName } from "../../lib/memberSearch";
import { AdminListHeader } from "./AdminListHeader";

type TabType = "active" | "archived";

export function AdminTeamsTab() {
  const teams = useTeamStore((s) => s.teams);
  const members = useMemberStore((s) => s.members);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const showToast = useUiStore((s) => s.showToast);
  const entityIcons = useSettingsStore((s) => s.entityIcons);
  const setEntityIcon = useSettingsStore((s) => s.setEntityIcon);
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [openAssignTeamId, setOpenAssignTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>([]);
  const selectedLeaderIdsRef = useRef<string[]>([]);
  const dropdownWrapRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [archivedActionId, setArchivedActionId] = useState<string | null>(null);
  const [archivedActionLoading, setArchivedActionLoading] = useState(false);
  // 보관함 다중 선택 일괄 삭제 상태
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 활성/보관 팀 분류 + 이름 알파벳/가나다 정렬 + 목록 검색 필터
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
    () => sortByKoreanName(
      selectedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((member): member is NonNullable<typeof member> => Boolean(member)),
    ),
    [membersById, selectedMemberIds],
  );
  const {
    suggestionMembers,
    isSuggestionOpen,
    highlightedIndex,
    setSuppressSuggestions,
    handleQueryChange,
    handleKeyDown,
    selectMember,
  } = useMemberSuggestionDropdown({
    members,
    query: memberQuery,
    excludedMemberIds: selectedMemberIds,
    dropdownWrapRef,
  });

  const setLeaderSelection = (nextIds: string[]) => {
    selectedLeaderIdsRef.current = nextIds;
    setSelectedLeaderIds(nextIds);
  };

  const buildLeaderSavedMessage = (leaderIds: string[]) => {
    if (leaderIds.length === 0) return "팀 리더 설정이 저장되었습니다.";
    const names = leaderIds
      .map((leaderId) => membersById.get(leaderId)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return "팀 리더 설정이 저장되었습니다.";
    if (names.length === 1 && names[0]) return `${names[0]}님이 리더로 등록되었습니다.`;
    if (names[0]) return `${names[0]}님 외 ${names.length - 1}명이 리더로 등록되었습니다.`;
    return "팀 리더 설정이 저장되었습니다.";
  };

  const formatLeaderNames = (leaderMemberIds: string[]) => {
    if (leaderMemberIds.length === 0) return "-";
    const names = leaderMemberIds
      .map((leaderId) => membersById.get(leaderId)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return "-";
    return names.join(", ");
  };

  const onCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    const created = await createTeamApi(name);
    upsertTeam(created);
    setNewTeamName("");
    setOpenCreate(false);
  };

  // 보관 팀 복원 (클릭 즉시)
  const onRestoreTeam = async (teamId: string) => {
    const restored = await restoreTeamApi(teamId);
    if (restored) upsertTeam(restored);
  };

  const onArchiveTeam = async (teamId: string) => {
    try {
      const archived = await archiveTeamApi(teamId);
      if (archived) {
        upsertTeam(archived);
      }
      if (openAssignTeamId === teamId) {
        setOpenAssignTeamId(null);
      }
    } catch (error) {
      console.error("[AdminTeams] 보관함 이동 실패", teamId, error);
      alert("보관함 이동에 실패했습니다. 콘솔을 확인해주세요.");
    }
  };

  // 보관함 일괄 영구 삭제 — 선택된 팀들을 병렬로 deleteTeamApi 호출
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
      const removedIds = new Set<string>();
      for (const r of results) {
        if (r.ok) {
          okCount++;
          removedIds.add(r.id);
        } else {
          failCount++;
        }
      }
      // 서버 삭제 성공한 항목만 로컬에서 제거
      if (removedIds.size > 0) {
        const remaining = useTeamStore
          .getState()
          .teams.filter((t) => !removedIds.has(t.teamId));
        useTeamStore.setState({ teams: remaining });
      }
      setBulkSelectedIds(new Set());
      setBulkConfirmOpen(false);
      if (failCount > 0) {
        alert(`삭제 완료 ${okCount}개, 실패 ${failCount}개. 콘솔을 확인해주세요.`);
      }
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

  const onOpenAssignModal = (teamId: string) => {
    const team = teams.find((t) => t.teamId === teamId);
    setOpenAssignTeamId(teamId);
    setEditingTeamName(team?.name ?? "");
    setMemberQuery("");
    setSuppressSuggestions(false);
    setSelectedMemberIds(team?.members.map((m) => m.memberId) ?? []);
    const initialLeaderIds = (team?.leaderMemberIds?.length
      ? team.leaderMemberIds
      : inferLeaderMemberIds("team", team?.members ?? [])) ?? [];
    setLeaderSelection(initialLeaderIds);
  };

  const updateSelectedMembers = (nextIds: string[]) => {
    setSelectedMemberIds((prev) => {
      const normalized = Array.from(new Set(nextIds));
      const next = normalized.length === prev.length &&
        normalized.every((memberId, index) => memberId === prev[index])
        ? prev
        : normalized;
      const nextLeaderIds = selectedLeaderIdsRef.current.filter((id) => next.includes(id));
      setLeaderSelection(nextLeaderIds);
      return next;
    });
  };

  const addMember = (memberId: string) => {
    updateSelectedMembers(
      selectedMemberIds.includes(memberId)
        ? selectedMemberIds
        : [...selectedMemberIds, memberId],
    );
  };

  const removeMember = (memberId: string) => {
    updateSelectedMembers(selectedMemberIds.filter((id) => id !== memberId));
  };

  const toggleLeader = (memberId: string) => {
    const nextLeaderIds = selectedLeaderIdsRef.current.includes(memberId)
      ? selectedLeaderIdsRef.current.filter((leaderId) => leaderId !== memberId)
      : [...selectedLeaderIdsRef.current, memberId];
    setLeaderSelection(nextLeaderIds);
  };

  const handleMemberQueryChange = (value: string) => {
    handleQueryChange(value, setMemberQuery);
  };

  const handleSelectSuggestion = (memberId: string) => {
    selectMember(memberId, addMember);
  };

  const handleMemberQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
    handleKeyDown(event, addMember);

  const onSaveMembers = async () => {
    if (!assignTeam) return;
    setSaving(true);
    try {
      const newName = editingTeamName.trim();
      const prevIds = new Set(assignTeam.members.map((m) => m.memberId));
      const nextIds = new Set(selectedMemberIds);
      const addIds = selectedMemberIds.filter((id) => !prevIds.has(id));
      const removeIds = assignTeam.members.map((m) => m.memberId).filter((id) => !nextIds.has(id));
      const currentLeaderIds = selectedLeaderIdsRef.current;
      const nextLeaderIds = currentLeaderIds.filter((leaderId) => nextIds.has(leaderId));
      const prevLeaders = assignTeam.leaderMemberIds ?? [];
      const leaderChanged =
        prevLeaders.length !== nextLeaderIds.length ||
        prevLeaders.some((leaderId) => !nextLeaderIds.includes(leaderId));
      const shouldUpdateTeamMeta = newName !== assignTeam.name || leaderChanged;
      const [updatedTeam] = await Promise.all([
        shouldUpdateTeamMeta
          ? updateTeamApi(
              assignTeam.teamId,
              newName || assignTeam.name,
              leaderChanged ? nextLeaderIds : undefined,
            )
          : Promise.resolve(null),
        ...addIds.map((memberId) => assignMemberToTeamApi(memberId, assignTeam.teamId)),
        ...removeIds.map((memberId) => unassignMemberFromTeamApi(memberId, assignTeam.teamId)),
      ]);
      const nextMembers = selectedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertTeam({
        ...assignTeam,
        ...(updatedTeam ?? {}),
        leaderMemberIds: nextLeaderIds,
        members: nextMembers,
      });
      showToast(buildLeaderSavedMessage(nextLeaderIds), { kind: "success" });
      setOpenAssignTeamId(null);
    } catch (error) {
      console.error("[AdminTeams] 리더 저장 실패", error);
      showToast("팀 리더 저장에 실패했습니다.", { kind: "error" });
    } finally {
      setSaving(false);
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

      {/* 팀 / 보관함 탭 + 검색 */}
      <AdminListHeader
        leftLabel="팀"
        activeTab={activeTab}
        query={listQuery}
        queryPlaceholder="팀 검색"
        onChangeTab={setActiveTab}
        onChangeQuery={setListQuery}
      />

      {activeTab === "active" ? (
        /* 활성 팀 목록 */
        <ul className="grid grid-cols-1 gap-2 text-sm">
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
                  className="flex w-full items-center justify-between rounded border border-zinc-200 bg-white px-4 py-3 text-left text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PageIconDisplay icon={entityIcons[team.teamId] ?? null} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        {team.name}
                      </span>
                      <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                        구성원 {team.members.length}명
                      </span>
                    </span>
                  </span>
                  <span
                    className="ml-4 flex max-w-[45%] shrink-0 items-center justify-end gap-1.5 text-right text-sm text-zinc-500 dark:text-zinc-400"
                    title={formatLeaderNames(team.leaderMemberIds ?? [])}
                  >
                    <span className="truncate">{formatLeaderNames(team.leaderMemberIds ?? [])}</span>
                    {(team.leaderMemberIds?.length ?? 0) > 0 && (
                      <Crown size={13} className="shrink-0 text-amber-500" />
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        /* 보관된 팀 목록 — 다중 선택 후 일괄 영구 삭제 가능 */
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
                      aria-label={`${team.name} 관리`}
                      onClick={() => setArchivedActionId(team.teamId)}
                      className="min-w-0 flex-1 truncate text-left text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                    >
                      {team.name}
                    </button>
                    <span
                      className="flex max-w-[45%] shrink-0 items-center justify-end gap-1.5 text-right text-xs text-zinc-500 dark:text-zinc-400"
                      title={formatLeaderNames(team.leaderMemberIds ?? [])}
                    >
                      <span className="truncate">{formatLeaderNames(team.leaderMemberIds ?? [])}</span>
                      {(team.leaderMemberIds?.length ?? 0) > 0 && (
                        <Crown size={12} className="shrink-0 text-amber-500" />
                      )}
                    </span>
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
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
                      // 서버 반환값을 확인해 실제 삭제 성공 시에만 로컬 제거
                      const ok = await deleteTeamApi(team.teamId);
                      if (ok) {
                        const current = useTeamStore.getState().teams.filter(
                          (t) => t.teamId !== team.teamId,
                        );
                        useTeamStore.setState({ teams: current });
                        setArchivedActionId(null);
                      } else {
                        alert(
                          "삭제 실패: 서버에서 팀을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.",
                        );
                      }
                    } catch (err) {
                      console.error("[AdminTeams] 영구 삭제 실패", team.teamId, err);
                      alert(
                        "삭제 실패: 권한 또는 네트워크 문제일 수 있습니다. 콘솔을 확인해주세요.",
                      );
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
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
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
            className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 pr-1">
              <div className="flex items-center gap-2">
                <IconPicker
                  current={entityIcons[openAssignTeamId] ?? null}
                  onChange={(icon) => setEntityIcon(openAssignTeamId, icon)}
                  size="md"
                />
                <input
                  value={editingTeamName}
                  onChange={(e) => setEditingTeamName(e.target.value)}
                  className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-zinc-900 outline-none hover:border-zinc-200 focus:border-zinc-400 dark:text-zinc-100 dark:hover:border-zinc-700 dark:focus:border-zinc-500"
                />
              </div>

              <section ref={dropdownWrapRef} className="relative">
                <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">구성원 검색</label>
                <div className="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
                  <Search size={14} className="shrink-0 text-zinc-400" />
                  <input
                    value={memberQuery}
                    onChange={(e) => handleMemberQueryChange(e.target.value)}
                    onKeyDown={handleMemberQueryKeyDown}
                    placeholder="구성원 검색"
                    className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none dark:text-zinc-100"
                  />
                </div>
                {isSuggestionOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {suggestionMembers.map((member, index) => (
                      <button
                        key={member.memberId}
                        type="button"
                        role="option"
                        aria-selected={highlightedIndex === index}
                        className={`flex w-full items-center px-2 py-1.5 text-left text-sm ${
                          highlightedIndex === index
                            ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectSuggestion(member.memberId)}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                  등록된 구성원 ({selectedMembers.length})
                </div>
                <div className="max-h-[52vh] overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/40">
                  {selectedMembers.length === 0 ? (
                    <div className="px-2 py-3 text-center text-sm text-zinc-400">
                      아직 등록된 구성원이 없습니다.
                    </div>
                  ) : (
                    selectedMembers.map((member) => {
                      const isLeader = selectedLeaderIds.includes(member.memberId);
                      return (
                        <div
                          key={member.memberId}
                          className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                              {member.name}
                              {isLeader && (
                                <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
                                  리더
                                </span>
                              )}
                            </div>
                            <div className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                              {member.email} · {member.jobRole}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => toggleLeader(member.memberId)}
                              className={`rounded px-1.5 py-1 text-xs ${
                                isLeader
                                  ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                                  : "bg-green-600 text-white"
                              }`}
                            >
                              {isLeader ? "리더 해제" : "리더 등록"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeMember(member.memberId)}
                              className="rounded border border-zinc-200 px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                              제거
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => void onArchiveTeam(assignTeam.teamId)}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
                disabled={saving}
              >
                보관함으로 이동
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onSaveMembers()}
                  disabled={saving}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenAssignTeamId(null)}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  disabled={saving}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 일괄 영구 삭제 확인 다이얼로그 */}
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
            <h4 className="text-sm font-semibold">선택한 {bulkSelectedIds.size}개 팀 영구 삭제</h4>
            <p className="mt-2 text-xs text-zinc-500">
              이 작업은 되돌릴 수 없습니다. DB 에서 완전히 제거되며 멤버 배정도 함께 해제됩니다.
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
