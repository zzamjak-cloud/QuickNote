import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";
import { Editor } from "../editor/Editor";

export function DatabaseRowPeek() {
  const peekPageId = useUiStore((s) => s.peekPageId);
  const closePeek = useUiStore((s) => s.closePeek);
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const renamePage = usePageStore((s) => s.renamePage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, peekPageId]);

  useEffect(() => {
    if (!peekPageId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekPageId, closePeek]);

  if (!peekPageId || !page || !databaseId || !bundle) return null;

  return (
    <div
      onClick={closePeek}
      className="fixed inset-0 z-40 bg-black/30"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-[480px] flex-col overflow-y-auto border-l border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        <button
          type="button"
          onClick={closePeek}
          className="mb-4 self-end rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={16} />
        </button>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="제목 없음"
          className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
        />
        <DatabasePropertyPanel databaseId={databaseId} pageId={peekPageId} />
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8 flex flex-1 flex-col">
          <Editor key={peekPageId} pageId={peekPageId} bodyOnly />
        </div>
      </div>
    </div>
  );
}
