import { Search } from "lucide-react";

type AdminListHeaderProps = {
  leftLabel: string;
  activeTab: "active" | "archived";
  query: string;
  queryPlaceholder: string;
  onChangeTab: (tab: "active" | "archived") => void;
  onChangeQuery: (value: string) => void;
};

export function AdminListHeader({
  leftLabel,
  activeTab,
  query,
  queryPlaceholder,
  onChangeTab,
  onChangeQuery,
}: AdminListHeaderProps) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => onChangeTab("active")}
        className={`h-9 px-3 text-sm font-medium transition-colors ${
          activeTab === "active"
            ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        {leftLabel}
      </button>
      <button
        type="button"
        onClick={() => onChangeTab("archived")}
        className={`h-9 px-3 text-sm font-medium transition-colors ${
          activeTab === "archived"
            ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        }`}
      >
        보관함
      </button>
      <div className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
        <Search size={13} className="text-zinc-400" />
        <input
          value={query}
          onChange={(e) => onChangeQuery(e.target.value)}
          placeholder={queryPlaceholder}
          className="w-36 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
    </div>
  );
}
