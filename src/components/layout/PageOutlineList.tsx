import { useMemo } from "react";
import { Hash } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { extractOutlineFromDocJson } from "../../lib/pageOutline";
import { scrollToOutlineHeadingIndex } from "../../lib/editor/editorNavigationBridge";

export function PageOutlineList() {
  const activePageId = usePageStore((s) => s.activePageId);
  const page = usePageStore((s) => (activePageId ? s.pages[activePageId] : undefined));
  const showToast = useUiStore((s) => s.showToast);

  const outline = useMemo(
    () => extractOutlineFromDocJson(page?.doc),
    [page?.doc],
  );

  if (!activePageId || !page) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        열린 페이지가 없습니다.
      </div>
    );
  }

  if (outline.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        이 페이지에는 목차가 없습니다. `#` ~ `####` 헤더를 추가해 보세요.
      </div>
    );
  }

  return (
    <nav aria-label="페이지 목차" className="space-y-1">
      {outline.map((item, idx) => (
        <button
          key={`${idx}-${item.level}-${item.text}`}
          type="button"
          onClick={() => {
            const ok = scrollToOutlineHeadingIndex(idx);
            if (!ok) {
              showToast("해당 헤더 위치를 찾지 못했습니다.", { kind: "error" });
            }
          }}
          className={[
            "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            "text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900",
            "dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          ].join(" ")}
          style={{ paddingLeft: `${item.level * 10}px` }}
          title={item.text}
        >
          <Hash
            size={13}
            className="shrink-0 text-zinc-400 group-hover:text-violet-500 dark:group-hover:text-violet-300"
          />
          <span className="truncate">{item.text}</span>
        </button>
      ))}
    </nav>
  );
}
