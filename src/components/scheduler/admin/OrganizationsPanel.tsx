// 설정 모달 — 조직 활성/비활성 패널.
import { Eye, EyeOff } from "lucide-react";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useSchedulerFiltersStore } from "../../../store/schedulerFiltersStore";

export function OrganizationsPanel() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const toggleOrg = useSchedulerFiltersStore((s) => s.toggleOrg);

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
          <div
            key={org.organizationId}
            className="flex items-center justify-between px-3 py-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
          >
            <span
              className={`text-sm font-medium ${
                isDisabled
                  ? "text-zinc-400 dark:text-zinc-500 line-through"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {org.name}
            </span>
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
        );
      })}
    </div>
  );
}
