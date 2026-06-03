import { DatabasePropertyPanel } from "../database/DatabasePropertyPanel";

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
  // 폴딩 헤더(접기 토글 + 속성 프리셋 드롭다운)와 본문은 DatabasePropertyPanel 이 직접 렌더한다.
  return (
    <DatabasePropertyPanel
      databaseId={databaseId}
      pageId={pageId}
      className={className}
    />
  );
}
