// 조직(실) 관리 탭

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useOrganizationStore } from "../../store/organizationStore";
import { useMemberStore } from "../../store/memberStore";
import {
  archiveOrganizationApi,
  assignMemberToOrganizationApi,
  createOrganizationApi,
  deleteOrganizationApi,
  restoreOrganizationApi,
  unassignMemberFromOrganizationApi,
  updateOrganizationApi,
} from "../../lib/sync/organizationApi";
import { inferLeaderMemberIds } from "../../lib/scheduler/mm/leaderDefaults";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { sortByKoreanName } from "../../lib/memberSearch";
import { AdminListHeader } from "./AdminListHeader";
import { EntityCard } from "../common/EntityCard";
import { EntityEditModal } from "../common/EntityEditModal";

type TabType = "active" | "archived";

export function AdminOrganizationsTab() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const upsertOrganization = useOrganizationStore((s) => s.upsertOrganization);
  const removeOrganization = useOrganizationStore((s) => s.removeOrganization);
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const entityIcons = useSettingsStore((s) => s.entityIcons);
  const setEntityIcon = useSettingsStore((s) => s.setEntityIcon);
  const entityDescriptions = useSettingsStore((s) => s.entityDescriptions);
  const setEntityDescription = useSettingsStore((s) => s.setEntityDescription);

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [openAssignOrgId, setOpenAssignOrgId] = useState<string | null>(null);
  const [editingOrgName, setEditingOrgName] = useState("");
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

  const activeOrgs = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return organizations
      .filter((o) => !o.removedAt)
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [organizations, listQuery]);

  const archivedOrgs = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return organizations
      .filter((o) => !!o.removedAt)
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [organizations, listQuery]);

  const assignOrg = useMemo(
    () => organizations.find((o) => o.organizationId === openAssignOrgId) ?? null,
    [organizations, openAssignOrgId],
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
    if (names.length === 0) return "조직 리더 설정이 저장되었습니다.";
    if (names.length === 1 && names[0]) return `${names[0]}님이 리더로 등록되었습니다.`;
    if (names[0]) return `${names[0]}님 외 ${names.length - 1}명이 리더로 등록되었습니다.`;
    return "조직 리더 설정이 저장되었습니다.";
  };

  const onCreateOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    const created = await createOrganizationApi(name);
    upsertOrganization(created);
    setNewOrgName("");
    setOpenCreate(false);
  };

  const onOpenAssignModal = (orgId: string) => {
    const org = organizations.find((o) => o.organizationId === orgId);
    setOpenAssignOrgId(orgId);
    setEditingOrgName(org?.name ?? "");
    setEditingDescription(entityDescriptions[orgId] ?? "");
    setSelectedMemberIds(org?.members.map((m) => m.memberId) ?? []);
    const initial =
      (org?.leaderMemberIds?.length
        ? org.leaderMemberIds
        : inferLeaderMemberIds("organization", org?.members ?? [])) ?? [];
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
    if (!assignOrg) return;
    setSaving(true);
    try {
      const newName = editingOrgName.trim();
      const prevIds = new Set(assignOrg.members.map((m) => m.memberId));
      const nextIds = new Set(selectedMemberIds);
      const addIds = selectedMemberIds.filter((id) => !prevIds.has(id));
      const removeIds = assignOrg.members
        .map((m) => m.memberId)
        .filter((id) => !nextIds.has(id));
      const currentLeaderIds = selectedLeaderIdsRef.current;
      const nextLeaderIds = currentLeaderIds.filter((id) => nextIds.has(id));
      const prevLeaders = assignOrg.leaderMemberIds ?? [];
      const leaderChanged =
        prevLeaders.length !== nextLeaderIds.length ||
        prevLeaders.some((id) => !nextLeaderIds.includes(id));
      const updatedOrg = await (newName !== assignOrg.name || leaderChanged
        ? updateOrganizationApi(
            assignOrg.organizationId,
            newName || assignOrg.name,
            leaderChanged ? nextLeaderIds : undefined,
          )
        : Promise.resolve(null));
      await Promise.all([
        ...addIds.map((id) => assignMemberToOrganizationApi(id, assignOrg.organizationId)),
        ...removeIds.map((id) =>
          unassignMemberFromOrganizationApi(id, assignOrg.organizationId),
        ),
      ]);
      const nextMembers = selectedMemberIds
        .map((id) => membersById.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertOrganization({
        ...assignOrg,
        ...(updatedOrg ?? {}),
        name: newName || assignOrg.name,
        leaderMemberIds: nextLeaderIds,
        members: nextMembers,
      });
      setEntityDescription(assignOrg.organizationId, editingDescription);
      showToast(buildLeaderSavedMessage(nextLeaderIds), { kind: "success" });
      setOpenAssignOrgId(null);
    } catch (error) {
      console.error("[AdminOrgs] 저장 실패", error);
      showToast("조직 저장에 실패했습니다.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const onArchiveOrg = async (orgId: string) => {
    try {
      const archived = await archiveOrganizationApi(orgId);
      if (archived) {
        upsertOrganization(archived);
        if (openAssignOrgId === orgId) setOpenAssignOrgId(null);
      }
    } catch (err) {
      console.error("[AdminOrgs] 보관함 이동 실패", orgId, err);
      alert("보관함 이동 실패. 콘솔을 확인해주세요.");
    }
  };

  const onRestoreOrg = async (orgId: string) => {
    try {
      const restored = await restoreOrganizationApi(orgId);
      if (restored) upsertOrganization(restored);
    } catch (err) {
      console.error("[AdminOrgs] 복원 실패", orgId, err);
      alert("복원 실패. 콘솔을 확인해주세요.");
    }
  };

  const onPermanentDeleteOrg = async (orgId: string) => {
    setSingleDeleting(true);
    try {
      const ok = await deleteOrganizationApi(orgId);
      if (ok) {
        removeOrganization(orgId);
        setDeleteConfirmId(null);
      } else {
        alert("삭제 실패: 서버에서 조직을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.");
      }
    } catch (err) {
      console.error("[AdminOrgs] 영구 삭제 실패", orgId, err);
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
            const ok = await deleteOrganizationApi(id);
            return { id, ok };
          } catch (err) {
            console.error("[AdminOrgs] 영구 삭제 실패", id, err);
            return { id, ok: false };
          }
        }),
      );
      for (const r of results) {
        if (r.ok) {
          okCount++;
          removeOrganization(r.id);
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

  const toggleBulkSelect = (orgId: string) =>
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });

  const toggleSelectAll = () => {
    if (bulkSelectedIds.size === archivedOrgs.length) {
      setBulkSelectedIds(new Set());
    } else {
      setBulkSelectedIds(new Set(archivedOrgs.map((o) => o.organizationId)));
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
          조직 추가
        </button>
      </div>

      <AdminListHeader
        leftLabel="조직"
        activeTab={activeTab}
        query={listQuery}
        queryPlaceholder="조직 검색"
        onChangeTab={setActiveTab}
        onChangeQuery={setListQuery}
      />

      {activeTab === "active" ? (
        <ul className="grid grid-cols-1 gap-2 text-sm">
          {activeOrgs.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              등록된 조직이 없습니다.
            </li>
          ) : (
            activeOrgs.map((org) => (
              <li key={org.organizationId}>
                <EntityCard
                  icon={entityIcons[org.organizationId] ?? null}
                  name={org.name}
                  memberCount={org.members.length}
                  leaderLabel={formatLeaderNames(org.leaderMemberIds ?? [])}
                  hasLeaders={(org.leaderMemberIds?.length ?? 0) > 0}
                  onClick={() => onOpenAssignModal(org.organizationId)}
                  ariaLabel={`${org.name} 구성원 관리`}
                />
              </li>
            ))
          )}
        </ul>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {archivedOrgs.length > 0 && (
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={bulkSelectedIds.size === archivedOrgs.length}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        bulkSelectedIds.size > 0 &&
                        bulkSelectedIds.size < archivedOrgs.length;
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
            {archivedOrgs.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                보관된 조직 없음
              </li>
            ) : (
              archivedOrgs.map((org) => (
                <li key={org.organizationId}>
                  <div className="flex items-center gap-2 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <input
                      type="checkbox"
                      aria-label={`${org.name} 선택`}
                      checked={bulkSelectedIds.has(org.organizationId)}
                      onChange={() => toggleBulkSelect(org.organizationId)}
                    />
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(org.organizationId)}
                      className="min-w-0 flex-1 truncate text-left text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                    >
                      {org.name}
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {/* 보관된 조직 액션 팝업 */}
      {deleteConfirmId &&
        (() => {
          const org = archivedOrgs.find((o) => o.organizationId === deleteConfirmId);
          if (!org) return null;
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
                <h4 className="text-sm font-semibold">{org.name}</h4>
                <p className="mt-1 text-xs text-zinc-500">보관된 조직입니다.</p>
                <div className="mt-4 flex justify-between gap-2">
                  <button
                    type="button"
                    disabled={singleDeleting}
                    onClick={() => void onPermanentDeleteOrg(org.organizationId)}
                    className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    {singleDeleting ? "삭제 중..." : "조직 영구 삭제"}
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
                        void onRestoreOrg(org.organizationId);
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

      {/* 조직 추가 모달 */}
      {openCreate && (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setOpenCreate(false);
              setNewOrgName("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold">새 조직 추가</h4>
            <input
              autoFocus
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateOrg();
              }}
              placeholder="조직 이름"
              className="mt-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenCreate(false);
                  setNewOrgName("");
                }}
                className="rounded border px-3 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onCreateOrg()}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 조직 편집 모달 */}
      {openAssignOrgId && assignOrg && (
        <EntityEditModal
          name={editingOrgName}
          onNameChange={setEditingOrgName}
          icon={entityIcons[openAssignOrgId] ?? null}
          onIconChange={(icon) => setEntityIcon(openAssignOrgId, icon)}
          description={editingDescription}
          onDescriptionChange={setEditingDescription}
          descriptionPlaceholder="조직 소개"
          selectedMembers={selectedMembers}
          allMembers={members}
          leaderMemberIds={selectedLeaderIds}
          onToggleLeader={toggleLeader}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onSave={onSaveMembers}
          onArchive={() => onArchiveOrg(assignOrg.organizationId)}
          onCancel={() => setOpenAssignOrgId(null)}
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
              선택한 {bulkSelectedIds.size}개 조직 영구 삭제
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
