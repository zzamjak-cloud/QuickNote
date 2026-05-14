import type { ViewKind } from "../../types/database";
import { VIEW_ICONS, VIEW_LABELS } from "./databaseBlockViewConstants";

type Props = {
  view: ViewKind;
  onViewChange: (v: ViewKind) => void;
  hiddenViewKinds?: ViewKind[];
};

export function DatabaseViewKindToggle({
  view,
  onViewChange,
  hiddenViewKinds = [],
}: Props) {
  const hidden = new Set<ViewKind>(hiddenViewKinds.filter((kind) => kind !== "table"));
  return (
    <>
      {(Object.keys(VIEW_ICONS) as ViewKind[]).map((vk) => {
        if (hidden.has(vk)) return null;
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
                ? "bg-emerald-600 font-bold text-white"
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
