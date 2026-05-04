import { usePageStore } from "../../store/pageStore";

/** 데이터베이스 행으로 쓸 페이지를 만들고 `databaseId`·빈 `dbCells`를 연결한다. */
export function createRowPageLinkedToDatabase(
  databaseId: string,
  title: string,
): string {
  const pageId = usePageStore.getState().createPage(title, null, {
    activate: false,
  });
  usePageStore.setState((s) => {
    const page = s.pages[pageId];
    if (!page) return s;
    return {
      pages: {
        ...s.pages,
        [pageId]: { ...page, databaseId, dbCells: {} },
      },
    };
  });
  return pageId;
}
