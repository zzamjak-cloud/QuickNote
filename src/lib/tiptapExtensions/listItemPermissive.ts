import { ListItem } from "@tiptap/extension-list";

/**
 * 글머리/번호 항목 안에 이미지·동영상·파일·콜아웃·컬럼 등 어떤 블록이든 자유롭게 넣을 수 있도록
 * 기본 content (`"paragraph block*"`) 를 더 느슨하게 확장한다.
 *
 * 기본 스키마는 첫 자식이 반드시 paragraph 라 다음 두 시나리오를 지원하지 못한다:
 *   1) 비어있는 새 항목에 /이미지 로 이미지를 삽입 → 이미지가 listItem 밖으로 lift 됨.
 *   2) 부모 항목 텍스트와 자식 항목 사이에 이미지/미디어 끼워 넣기 — Notion 가져오기 시
 *      block child 를 첨부해도 schema가 받아주지 않으면 사라진다.
 *
 * 변경: 첫 위치에도 이미지·fileBlock·horizontalRule·columnLayout·callout·toggle·blockquote 같은
 * 블록을 허용한다. 첫 자식이 paragraph 가 아니어도 Enter/Backspace 등 list 기본 키맵은
 * 정상 동작한다 (split/lift 헬퍼가 paragraph 부재 케이스를 graceful 처리).
 */
export const ListItemPermissive = ListItem.extend({
  content: "block+",
});
