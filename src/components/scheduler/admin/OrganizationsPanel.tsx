// 설정 모달 — 조직 활성/비활성 패널.
import { useState } from "react";
import { Check, Eye, EyeOff, Pencil, X } from "lucide-react";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useSchedulerFiltersStore } from "../../../store/schedulerFiltersStore";
import { updateOrganizationApi } from "../../../lib/sync/organizationApi";
import { inferLeaderMemberIds } from "../../../lib/scheduler/mm/leaderDefaults";
import { LeaderMemberPicker } from "../mm/LeaderMemberPicker";

export function OrganizationsPanel() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const upsertOrganization = useOrganizationStore((s) => s.upsertOrganization);
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const toggleOrg = useSchedulerFiltersStore((s) => s.toggleOrg);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [leaderDraft, setLeaderDraft] = useState<string[]>([]);

  async function saveLeaders(organizationId: string) {
    const updated = await updateOrganizationApi(organizationId, undefined, leaderDraft);
    upsertOrganization(updated);
    setEditingId(null);
  }

  if (organizations.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-zinc-400">
        등록된 조직이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        비활성화한 조직은 헤더 드롭다운에 표시되지 않습니다.
      </p>
      {organizations.map((org) => {
        const isDisabled = disabledOrgIds.includes(org.organizationId);
        return (
          <div key={org.organizationId} className="rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    isDisabled
                      ? "text-zinc-400 dark:text-zinc-500 line-through"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {org.name}
                </span>
                <span className="text-xs text-zinc-400">
                  조직장 {(org.leaderMemberIds ?? []).length}명
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(editingId === org.organizationId ? null : org.organizationId);
                    setLeaderDraft((org.leaderMemberIds?.length ? org.leaderMemberIds : inferLeaderMemberIds("organization", org.members)) ?? []);
                  }}
                  title="조직장 편집"
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                  <Pencil size={15} className="text-zinc-500" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleOrg(org.organizationId)}
                  title={isDisabled ? "활성화" : "비활성화"}
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                  {isDisabled ? (
                    <EyeOff size={16} className="text-zinc-400" />
                  ) : (
                    <Eye size={16} className="text-amber-500" />
                  )}
                </button>
              </div>
            </div>
            {editingId === org.organizationId && (
              <div className="space-y-3 border-t border-zinc-200 p-3 dark:border-zinc-700">
                <LeaderMemberPicker
                  label="조직장"
                  members={org.members}
                  value={leaderDraft}
                  recommendedIds={inferLeaderMemberIds("organization", org.members)}
                  onChange={setLeaderDraft}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveLeaders(org.organizationId)}
                    className="inline-flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600"
                  >
                    <Check size={12} />
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="inline-flex items-center gap-1 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <X size={12} />
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
