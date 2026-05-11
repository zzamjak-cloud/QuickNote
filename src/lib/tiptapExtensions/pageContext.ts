import { Extension, type Editor } from "@tiptap/core";

/**
 * 현재 에디터가 어떤 페이지를 편집 중인지(피크/풀뷰/일반 페이지 등) 를 노출하는
 * 보조 확장. 슬래시 명령처럼 editor 인스턴스밖에 받지 못하는 곳에서
 * editor.storage.pageContext.pageId 로 호스트 페이지 ID 를 가져올 수 있다.
 */
export interface PageContextStorage {
  pageId: string | null;
}

declare module "@tiptap/core" {
  interface Storage {
    pageContext: PageContextStorage;
  }
}

export const PageContext = Extension.create<unknown, PageContextStorage>({
  name: "pageContext",
  addStorage() {
    return { pageId: null };
  },
});

export function setPageContext(
  editor: Editor | null,
  pageId: string | null,
): void {
  if (!editor) return;
  const storage = editor.storage.pageContext as PageContextStorage | undefined;
  if (!storage) return;
  storage.pageId = pageId;
}
