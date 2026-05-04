import type { ViewKind } from "../../types/database";
import { VIEW_ICONS, VIEW_LABELS } from "./databaseBlockViewConstants";

type Props = {
  view: ViewKind;
  onViewChange: (v: ViewKind) => void;
};

export function DatabaseViewKindToggle({ view, onViewChange }: Props) {
  return (
    <>
      {(Object.keys(VIEW_ICONS) as ViewKind[]).map((vk) => {
        const Icon = VIEW_ICONS[vk];
        const on = view === vk;
        return (
          <button
            key={vk}
            type="button"
            title={VIEW_LABELS[vk]}
            onClick={() => onViewChange(vk)}
            className={[
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              on
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            <Icon size={14} />
            <span>{VIEW_LABELS[vk]}</span>
          </button>
        );
      })}
    </>
  );
}
