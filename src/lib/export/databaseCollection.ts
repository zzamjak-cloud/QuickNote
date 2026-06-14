import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { formatPlainDisplay } from "../../components/database/databaseCellDisplayUtils";

/**
 * databaseBlock 의 databaseId 로 store 에서 행을 모아 노션 collection 표 데이터를 만든다.
 * HTML export 에서 thead(컬럼명)/tbody(셀 텍스트) 구조로 직렬화하기 위한 평탄화 결과.
 * DB 가 없거나 컬럼이 없으면 null.
 */
export function collectDatabaseCollection(
  databaseId: string,
): { headers: string[]; rows: string[][] } | null {
  const bundle = useDatabaseStore.getState().databases[databaseId];
  if (!bundle) return null;
  const columns = bundle.columns;
  if (columns.length === 0) return null;

  const headers = columns.map((col) => col.name);
  const pages = usePageStore.getState().pages;
  const rows: string[][] = [];
  for (const pageId of bundle.rowPageOrder) {
    const page = pages[pageId];
    if (!page) continue;
    rows.push(
      columns.map((col) =>
        col.type === "title"
          ? (page.title ?? "")
          : formatPlainDisplay(page.dbCells?.[col.id] ?? null, col),
      ),
    );
  }
  return { headers, rows };
}
