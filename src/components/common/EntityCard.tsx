import { Crown } from "lucide-react";
import { PageIconDisplay } from "./PageIconDisplay";

type Props = {
  icon: string | null;
  name: string;
  memberCount?: number;
  leaderLabel: string;
  hasLeaders: boolean;
  onClick: () => void;
  ariaLabel?: string;
};

export function EntityCard({ icon, name, memberCount, leaderLabel, hasLeaders, onClick, ariaLabel }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-2xl dark:bg-zinc-800">
        <PageIconDisplay icon={icon} size="md" />
      </div>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {name}
        </span>
        {typeof memberCount === "number" && (
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            구성원 {memberCount}명
          </span>
        )}
      </span>
      {hasLeaders && (
        <span
          className="ml-2 flex max-w-[35%] shrink-0 items-center gap-1.5 text-right text-sm text-zinc-500 dark:text-zinc-400"
          title={leaderLabel}
        >
          <span className="truncate">{leaderLabel}</span>
          <Crown size={13} className="shrink-0 text-amber-500" />
        </span>
      )}
    </button>
  );
}
