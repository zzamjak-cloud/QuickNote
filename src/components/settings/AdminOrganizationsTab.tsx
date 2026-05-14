// 조직(실) 관리 탭 — AdminTeamsTab 과 동일한 UX 구조

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useOrganizationStore } from "../../store/organizationStore";
import { useMemberStore } from "../../store/memberStore";

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

  // 활성/보관 조직 분류 (removedAt 기반)
  const activeOrgs = useMemo(() => organizations.filter((o) => !o.removedAt), [organizations]);
  const archivedOrgs = useMemo(() => organizations.filter((o) => !!o.removedAt), [organizations]);

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

  /** 조직 보관함 이동 */
  const onArchiveOrg = (orgId: string) => {
    const org = organizations.find((o) => o.organizationId === orgId);
    if (!org) return;
    upsertOrganization({ ...org, removedAt: new Date().toISOString() });
    if (openAssignOrgId === orgId) setOpenAssignOrgId(null);
  };

  /** 보관 조직 복원 */
  const onRestoreOrg = (orgId: string) => {
    const org = organizations.find((o) => o.organizationId === orgId);
    if (!org) return;
    upsertOrganization({ ...org, removedAt: undefined });
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
          <ul className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
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
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
            보관된 조직
          </div>
          <ul className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
            {archivedOrgs.length === 0 ? (
              <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
                보관된 조직 없음
              </li>
            ) : (
              archivedOrgs.map((org) => (
                <li key={org.organizationId}>
                  <button
                    type="button"
                    aria-label={`${org.name} 관리`}
                    onClick={() => setDeleteConfirmId(org.organizationId)}
                    className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">
                      {org.name}
                    </span>
                  </button>
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
                  onClick={() => { removeOrganization(org.organizationId); setDeleteConfirmId(null); }}
                  className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  조직 영구 삭제
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={() => { onRestoreOrg(org.organizationId); setDeleteConfirmId(null); }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
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
                onClick={() => onArchiveOrg(assignOrg.organizationId)}
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
    </div>
  );
}
