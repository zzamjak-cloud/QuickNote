import { ChevronDown, ChevronRight } from "lucide-react";
import { DatabasePropertyPanel } from "../database/DatabasePropertyPanel";
import { useSettingsStore } from "../../store/settingsStore";

interface DbPropertySectionProps {
  databaseId: string;
  pageId: string;
  /** wrapper div의 추가 클래스, 기본 "mt-2" */
  className?: string;
}

export function DbPropertySection({
  databaseId,
  pageId,
  className = "mt-2",
}: DbPropertySectionProps) {
  // DB 속성 패널 열림/닫힘 상태를 내부에서 직접 구독
  const dbPropertyPanelOpen = useSettingsStore((s) => s.dbPropertyPanelOpen);
  const setDbPropertyPanelOpen = useSettingsStore(
    (s) => s.setDbPropertyPanelOpen,
  );

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setDbPropertyPanelOpen(!dbPropertyPanelOpen)}
        className="mb-1 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        {dbPropertyPanelOpen ? (
          <ChevronDown size={13} />
        ) : (
          <ChevronRight size={13} />
        )}
        속성
      </button>
      {dbPropertyPanelOpen && (
        <DatabasePropertyPanel databaseId={databaseId} pageId={pageId} />
      )}
    </div>
  );
}
