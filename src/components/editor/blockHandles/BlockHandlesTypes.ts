// BlockHandles 내부 타입 — 원시 타입만 참조(외부 의존 없음), 위치만 분리.

/** 댓글 1개 이상인 블록 — 오른쪽 사이드바 카드(상시) */
export type PinnedCommentBadge = {
  key: string;
  blockStart: number;
  blockId: string;
  count: number;
  top: number;
  commentLeft: number;
  /** 블록의 모든 댓글(시간순) — 사이드바에서 전체 표시 */
  messages: { id: string; bodyText: string; authorName: string }[];
};

export type DownloadNotice = {
  kind: "loading" | "success" | "error";
  message: string;
} | null;
