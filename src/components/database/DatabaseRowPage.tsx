import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Editor } from "../editor/Editor";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";

export function DatabaseRowPage({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const renamePage = usePageStore((s) => s.renamePage);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, pageId]);

  if (!page || !databaseId || !bundle) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        행 페이지를 찾을 수 없습니다.
      </div>
    );
  }

  const goBackToDatabase = () => {
    // DB가 풀페이지로 별도 열려 있지 않다면 단순히 이전 탭 페이지로 복귀.
    // 여기서는 이전 활성 페이지 정보를 알 수 없으므로 첫 일반 페이지로.
    const firstNormal = Object.values(usePageStore.getState().pages)
      .filter((p) => p.databaseId == null)
      .sort((a, b) => a.order - b.order)[0];
    setActivePage(firstNormal?.id ?? null);
    setCurrentTabPage(firstNormal?.id ?? null);
  };

  return (
    <div className="mx-auto max-w-[840px] px-12 py-8">
      <button
        type="button"
        onClick={goBackToDatabase}
        className="mb-6 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ArrowLeft size={12} /> {bundle.meta.title}
      </button>

      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => renamePage(pageId, titleDraft.trim() || "제목 없음")}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="제목 없음"
        className="w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400"
      />

      <DatabasePropertyPanel databaseId={databaseId} pageId={pageId} />

      <Editor />
    </div>
  );
}
