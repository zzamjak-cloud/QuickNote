// 블록 댓글 대상 판정 — 컬럼/탭/콜아웃/인용/코드/표 같은 컨테이너 블록은
// 자체적으로 내부에 다른 컨텐츠 블록을 가지므로 "최상위 부모"에는 댓글 입력을 허용하지 않는다.
// 댓글은 내부의 leaf 컨텐츠 블록에만 부착된다.
//
// 새 블록 타입을 추가할 때, 그것이 다른 블록들을 자식으로 갖는 "컨테이너"라면 이 목록에 등록하라.

import { isCalloutBlockNodeType } from "../blocks/uiPolicy";

/**
 * 컨테이너 블록 타입 — 최상위 부모에는 댓글 아이콘 비표시.
 * 콜아웃은 다양한 variant("calloutInfo" 등) 가 있으므로 별도 헬퍼로 판정한다.
 */
const STATIC_CONTAINER_BLOCK_TYPES = new Set<string>([
  "columnLayout",
  "tabBlock",
  "blockquote",
  "codeBlock",
  "table",
  // 토글 / 제목 토글 — 내부 콘텐츠에만 댓글 허용
  "toggle",
  // 인라인/풀페이지 DB 블록 — 행 단위로 댓글이 따로 관리되므로 블록 자체엔 댓글 불허
  "database",
  "databaseBlock",
]);

/** 해당 블록 타입의 최상위 노드에 댓글 입력을 허용할지 여부 */
export function canBlockHaveComment(nodeTypeName: string): boolean {
  if (STATIC_CONTAINER_BLOCK_TYPES.has(nodeTypeName)) return false;
  if (isCalloutBlockNodeType(nodeTypeName)) return false;
  return true;
}
