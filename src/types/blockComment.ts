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
  /**
   * 가져오기(노션 등)로 생성된 댓글에서 원본 작성자 memberId 를 서버에 보존 요청할 때만 설정.
   * 서버가 유효한 구성원인지 검증 후 authorMemberId 로 사용한다(일반 댓글엔 미설정 → 호출자 강제).
   * 로컬 표시는 authorMemberId 를 그대로 쓴다.
   */
  importedAuthorMemberId?: string;
};

/** 페이지에 저장되는 블록 댓글 묶음 — `Page.blockComments` */
export type PageBlockCommentsSnapshot = {
  messages: BlockCommentMsg[];
  /** 스레드별 마지막 확인 시각 — 키는 해당 페이지 문서 내 `blockId` */
  threadVisitedAt: Record<string, number>;
};
