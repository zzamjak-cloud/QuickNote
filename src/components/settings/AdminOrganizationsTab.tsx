// 조직(실) 관리 탭 — AdminTeamsTab 과 동일한 UX 구조

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useOrganizationStore } from "../../store/organizationStore";
import { useMemberStore } from "../../store/memberStore";
import {
  archiveOrganizationApi,
  deleteOrganizationApi,
  restoreOrganizationApi,
} from "../../lib/sync/organizationApi";

type TabType = "active" | "archived";

export function AdminOrganizationsTab() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const upsertOrganization = useOrganizationStore((s) => s.upsertOrganization);
  const removeOrganization = useOrganizationStore((s) => s.removeOrganization);
  const members = useMemberStore((s) => s.members);

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [openCreate, setOpenCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [openAssignOrgId, setOpenAssignOrgId] = useState<string | null>(null);
  const [editingOrgName, setEditingOrgName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [singleDeleting, setSingleDeleting] = useState(false);
  // 보관함 다중 선택 일괄 삭제 상태
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 활성/보관 조직 분류 (removedAt 기반) + 이름 정렬
  const activeOrgs = useMemo(
    () =>
      organizations
        .filter((o) => !o.removedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [organizations],
  );
  const archivedOrgs = useMemo(
    () =>
      organizations
        .filter((o) => !!o.removedAt)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [organizations],
  );

  const assignOrg = useMemo(
    () => organizations.find((o) => o.organizationId === openAssignOrgId) ?? null,
    [organizations, openAssignOrgId],
  );

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.memberId, m])),
    [members],
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
        (m.jobRole ?? "").toLowerCase().includes(q),
    );
  }, [members, search, selectedMemberIds]);

  /** 조직 생성 (로컬 only) */
  const onCreateOrg = () => {
    const name = newOrgName.trim();
    if (!name) return;
    const orgId = "org-" + Date.now().toString(36);
    upsertOrganization({ organizationId: orgId, name, members: [], createdAt: new Date().toISOString() });
    setNewOrgName("");
    setOpenCreate(false);
  };

  const onOpenAssignModal = (orgId: string) => {
    const org = organizations.find((o) => o.organizationId === orgId);
    setOpenAssignOrgId(orgId);
    setEditingOrgName(org?.name ?? "");
    setSearch("");
    setSelectedMemberIds(org?.members.map((m) => m.memberId) ?? []);
  };

  const onToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  /** 조직 구성원 저장 (로컬 only) */
  const onSaveMembers = () => {
    if (!assignOrg) return;
    setSaving(true);
    try {
      const newName = editingOrgName.trim();
      const nextMembers = selectedMemberIds
        .map((id) => membersById.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      upsertOrganization({
        ...assignOrg,
        name: newName || assignOrg.name,
        members: nextMembers,
      });
      setOpenAssignOrgId(null);
    } finally {
      setSaving(false);
    }
  };

  /** 조직 보관함 이동 — 서버에 removedAt 설정 후 로컬 반영 */
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

  /** 보관 조직 복원 — 서버에서 removedAt 제거 후 로컬 반영 */
  const onRestoreOrg = async (orgId: string) => {
    try {
      const restored = await restoreOrganizationApi(orgId);
      if (restored) upsertOrganization(restored);
    } catch (err) {
      console.error("[AdminOrgs] 복원 실패", orgId, err);
      alert("복원 실패. 콘솔을 확인해주세요.");
    }
  };

  /** 영구 삭제 — 서버 deleteOrganizationApi 호출 후 성공 시에만 로컬 제거 */
  const onPermanentDeleteOrg = async (orgId: string) => {
    setSingleDeleting(true);
    try {
      const ok = await deleteOrganizationApi(orgId);
      if (ok) {
        removeOrganization(orgId);
        setDeleteConfirmId(null);
      } else {
        alert(
          "삭제 실패: 서버에서 조직을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.",
        );
      }
    } catch (err) {
      console.error("[AdminOrgs] 영구 삭제 실패", orgId, err);
      alert(
        "삭제 실패: 권한 또는 네트워크 문제일 수 있습니다. 콘솔을 확인해주세요.",
      );
    } finally {
      setSingleDeleting(false);
    }
  };

  /** 보관함 일괄 영구 삭제 */
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
      if (failCount > 0) {
        alert(`삭제 완료 ${okCount}개, 실패 ${failCount}개. 콘솔을 확인해주세요.`);
      }
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">조직 관리</h3>
        {activeTab === "active" && (
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Plus size={12} />
            조직 추가
          </button>
        )}
      </div>

      {/* 조직 / 보관함 탭 */}
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
          조직
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
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
            조직 목록
          </div>
          <ul className="grid grid-cols-1 gap-2 p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
            {activeOrgs.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                등록된 조직이 없습니다.
              </li>
            ) : (
              activeOrgs.map((org) => (
                <li key={org.organizationId}>
                  <button
                    type="button"
                    aria-label={`${org.name} 구성원 관리`}
                    onClick={() => onOpenAssignModal(org.organizationId)}
                    className="flex w-full items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100 dark:hover:bg-emerald-950/55"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {org.name} ({org.members.length}명)
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-medium">
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
              <span>
                보관된 조직
                {bulkSelectedIds.size > 0 && ` (${bulkSelectedIds.size}개 선택)`}
              </span>
            </div>
            {bulkSelectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(true)}
                disabled={bulkDeleting}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                선택한 {bulkSelectedIds.size}개 영구 삭제
              </button>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-2 p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
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
                      aria-label={`${org.name} 관리`}
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
        </div>
      )}

      {/* 보관된 조직 액션 팝업 */}
      {deleteConfirmId && (() => {
        const org = archivedOrgs.find((o) => o.organizationId === deleteConfirmId);
        if (!org) return null;
        return (
          <div
            className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteConfirmId(null); }}
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
                    onClick={() => { void onRestoreOrg(org.organizationId); setDeleteConfirmId(null); }}
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
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setOpenCreate(false); setNewOrgName(""); } }}
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
              onKeyDown={(e) => e.key === "Enter" && onCreateOrg()}
              placeholder="조직 이름"
              className="mt-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOpenCreate(false); setNewOrgName(""); }}
                className="rounded border px-3 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={onCreateOrg}
                className="rounded bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 조직 구성원 관리 모달 */}
      {openAssignOrgId && assignOrg ? (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenAssignOrgId(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-4xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <input
                value={editingOrgName}
                onChange={(e) => setEditingOrgName(e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm font-semibold outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
              />
              <span className="shrink-0 text-xs text-zinc-400">구성원 관리</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {/* 등록된 구성원 */}
              <section className="min-h-72 rounded-md border border-zinc-200 dark:border-zinc-700">
                <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
                  등록된 구성원
                </div>
                <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
                  {selectedMemberIds.map((memberId) => {
                    const m = membersById.get(memberId);
                    if (!m) return null;
                    return (
                      <li key={memberId} className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100">
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

              {/* 전체 구성원 검색 */}
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
                onClick={() => void onArchiveOrg(assignOrg.organizationId)}
                className="rounded border border-amber-200 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                disabled={saving}
              >
                보관함으로 이동
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenAssignOrgId(null)}
                  className="rounded border px-3 py-1 text-xs"
                  disabled={saving}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={onSaveMembers}
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
            <h4 className="text-sm font-semibold">선택한 {bulkSelectedIds.size}개 조직 영구 삭제</h4>
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
