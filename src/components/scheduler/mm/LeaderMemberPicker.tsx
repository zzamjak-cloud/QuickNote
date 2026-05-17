import { Crown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Member } from "../../../store/memberStore";

type Props = {
  label: string;
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
  recommendedIds?: string[];
};

export function LeaderMemberPicker({
  label,
  members,
  value,
  onChange,
  recommendedIds = [],
}: Props) {
  const [query, setQuery] = useState("");
  const valueSet = useMemo(() => new Set(value), [value]);
  const selectedMembers = members.filter((member) => valueSet.has(member.memberId));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = members.filter((member) => {
    if (member.status !== "active") return false;
    if (!normalizedQuery) return true;
    return [member.name, member.jobTitle, member.jobRole]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(normalizedQuery));
  });

  const toggle = (memberId: string) => {
    onChange(valueSet.has(memberId)
      ? value.filter((id) => id !== memberId)
      : [...value, memberId]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </label>
        {recommendedIds.length > 0 && value.length === 0 && (
          <button
            type="button"
            onClick={() => onChange(recommendedIds)}
            className="rounded border border-amber-200 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
          >
            직책 기준 적용
          </button>
        )}
      </div>
      <div className="min-h-9 rounded border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/40">
        {selectedMembers.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-zinc-400">등록된 리더가 없습니다.</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedMembers.map((member) => (
              <span
                key={member.memberId}
                className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200"
              >
                {member.name}
                <Crown size={11} className="text-amber-500" />
                <button
                  type="button"
                  onClick={() => toggle(member.memberId)}
                  className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label={`${member.name} 제거`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
        <Search size={12} className="shrink-0 text-zinc-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="리더 검색"
          className="min-w-0 flex-1 bg-transparent text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
        />
      </div>
      <div className="max-h-32 overflow-y-auto rounded border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
        {filteredMembers.map((member) => (
          <label
            key={member.memberId}
            className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs text-zinc-800 dark:text-zinc-200">{member.name}</span>
              <span className="block truncate text-[11px] text-zinc-400">{member.jobTitle || member.jobRole}</span>
            </span>
            <input
              type="checkbox"
              checked={valueSet.has(member.memberId)}
              onChange={() => toggle(member.memberId)}
              className="accent-amber-500"
            />
          </label>
        ))}
        {filteredMembers.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-zinc-400">검색 결과가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
