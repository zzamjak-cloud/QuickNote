import { usePageStore } from "../../store/pageStore";
import type { CellValue } from "../../types/database";

/** 데이터베이스 행으로 쓸 페이지를 만들고 `databaseId`·초기 `dbCells`를 연결한다. */
export function createRowPageLinkedToDatabase(
  databaseId: string,
  title: string,
  dbCells: Record<string, CellValue> = {},
): string {
  return usePageStore.getState().createPage(title, null, {
    activate: false,
    databaseId,
    dbCells,
  });
}
