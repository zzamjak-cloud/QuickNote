import type { JSONContent } from "@tiptap/react";

export type NotionCollectionTable = {
  headers: string[];
  rows: Array<{
    cells: string[];
    titleLinkPath: string | null;
    cellMeta: Array<{
      hasTimeTag: boolean;
      statusColorToken: string | null;
      statusLike: boolean;
      // 다중 선택 옵션 개수 (1 = single-select, 2+ = multi-select)
      selectedCount: number;
      // 선택된 옵션들 + 각각의 색 토큰
      selectedOptions: Array<{ label: string; colorToken: string | null }>;
      // 사람 속성 (Notion .user / .notion-user / role 아이콘)
      hasPerson: boolean;
      personNames: string[];
    }>;
  }>;
};

export type HtmlToDocOptions = {
  onCollectionTable?: (table: NotionCollectionTable) => string | null;
  resolveImageSrc?: (src: string) => string | null;
  resolveImageNode?: (src: string, element: HTMLElement) => JSONContent | null;
  resolveMediaNode?: (src: string, element: HTMLElement) => JSONContent | null;
  iconReplacementText?: string;
  currentPagePath?: string;
  resolvePageMentionByHref?: (href: string) => { pageId: string; label?: string; intraPage?: boolean } | null;
  deferPageMentions?: boolean;
  /**
   * 자기참조(intraPage) 링크 라벨 → 유일하게 일치하는 heading 블록 id 를 해소한다.
   * 노션 export 는 블록 링크의 #fragment 를 폐기하므로, 라벨↔제목 정확·유일 매칭으로
   * 안정적 blockId 를 복원한다. 유일 매칭이 아니면 null.
   */
  resolveIntraPageBlockId?: (label: string) => string | null;
};
