/** 블록 스레드 내 단일 댓글 — 페이지 `blockComments` JSON에 직렬화된다. */
export type BlockCommentMsg = {
  id: string;
  workspaceId?: string | null;
  pageId: string;
  blockId: string;
  authorMemberId: string;
  bodyText: string;
  mentionMemberIds: string[];
  parentId: string | null;
  createdAt: number;
};

/** 페이지에 저장되는 블록 댓글 묶음 — `Page.blockComments` */
export type PageBlockCommentsSnapshot = {
  messages: BlockCommentMsg[];
  /** 스레드별 마지막 확인 시각 — 키는 해당 페이지 문서 내 `blockId` */
  threadVisitedAt: Record<string, number>;
};
