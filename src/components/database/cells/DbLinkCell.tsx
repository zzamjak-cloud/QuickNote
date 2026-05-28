import { useRef, useState } from "react";
import { Database, Search } from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useUiStore } from "../../../store/uiStore";
import { emptyPanelState } from "../../../types/database";
import { DbLinkSearchPopup } from "./DbLinkSearchPopup";

type Props = {
  value: string | null;
  onChange: (dbId: string | null) => void;
};

export function DbLinkCell({ value, onChange }: Props) {
  const [popupOpen, setPopupOpen] = useState(false);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const databases = useDatabaseStore((s) => s.databases);
  const findFullPagePageIdForDatabase = usePageStore((s) => s.findFullPagePageIdForDatabase);
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const openPeek = useUiStore((s) => s.openPeek);

  const linkedDb = value ? databases[value] : null;

  function openDbInPeek(dbId: string) {
    const dbTitle = databases[dbId]?.meta.title ?? "데이터베이스";
    const pageId =
      findFullPagePageIdForDatabase(dbId) ??
      (() => {
        const id = createPage(dbTitle, null, { activate: false });
        updateDoc(id, {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId: dbId,
                layout: "fullPage",
                view: "table",
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        });
        return id;
      })();
    openPeek(pageId);
  }

  return (
    <div className="group flex min-h-[24px] w-full items-center gap-1 rounded px-1 py-0.5">
      {linkedDb ? (
        <button
          type="button"
          onClick={() => openDbInPeek(linkedDb.meta.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-0.5 text-xs"
          style={{ backgroundColor: "#bfd5f3", color: "#0f345c" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#a8c5ef")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#bfd5f3")}
          title={`${linkedDb.meta.title}로 이동`}
        >
          <Database size={11} className="shrink-0" style={{ color: "#0f345c" }} />
          <span className="truncate font-semibold">{linkedDb.meta.title || "제목 없음"}</span>
        </button>
      ) : (
        <span className="text-xs text-zinc-400">연결 없음</span>
      )}

      {/* 돋보기 — DB 검색 팝업 열기 */}
      <button
        ref={searchBtnRef}
        type="button"
        onClick={() => setPopupOpen(true)}
        className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        title="DB 연결 변경"
      >
        <Search size={12} />
      </button>

      {popupOpen && (
        <DbLinkSearchPopup
          anchorEl={searchBtnRef.current}
          currentValue={value}
          onSelect={(dbId) => onChange(dbId)}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  );
}
