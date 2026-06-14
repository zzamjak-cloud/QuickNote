// 멘션 id prefix 규약 단일 등록점 — "p:" 페이지 / "d:" 데이터베이스 / "m:" 멤버.
// 과거 mention.tsx·pageMentionClick.ts 등에 동일한 startsWith 분기가 흩어져 이중진실원이었다.
// 각 호출부의 판정 "구성"은 그대로 두고(미묘한 precedence 차이 보존), prefix 리터럴만 여기로 모은다.
export const MENTION_PAGE_PREFIX = "p:";
export const MENTION_DATABASE_PREFIX = "d:";
export const MENTION_MEMBER_PREFIX = "m:";

export function hasPagePrefix(id: string): boolean {
  return id.startsWith(MENTION_PAGE_PREFIX);
}
export function hasDatabasePrefix(id: string): boolean {
  return id.startsWith(MENTION_DATABASE_PREFIX);
}
export function hasMemberPrefix(id: string): boolean {
  return id.startsWith(MENTION_MEMBER_PREFIX);
}

/** kindAttr 가 "page" 이거나 id 가 p: 로 시작. */
export function isPageMention(id: string, kindAttr?: string | null): boolean {
  return kindAttr === "page" || hasPagePrefix(id);
}
/** kindAttr 가 "database" 이거나 id 가 d: 로 시작. */
export function isDatabaseMention(id: string, kindAttr?: string | null): boolean {
  return kindAttr === "database" || hasDatabasePrefix(id);
}
/** kindAttr 가 "member" 이거나 id 가 m: 로 시작. */
export function isMemberMention(id: string, kindAttr?: string | null): boolean {
  return kindAttr === "member" || hasMemberPrefix(id);
}

export function stripPagePrefix(id: string): string {
  return hasPagePrefix(id) ? id.slice(MENTION_PAGE_PREFIX.length) : id;
}
export function stripMemberPrefix(id: string): string {
  return hasMemberPrefix(id) ? id.slice(MENTION_MEMBER_PREFIX.length) : id;
}

/** data-mention-kind 미지정 시 id prefix 로 kind 를 도출(없으면 페이지로 간주). */
export function resolveMentionKindAttr(id: string, attr: string | null | undefined): string {
  return (
    attr ??
    (hasPagePrefix(id)
      ? "page"
      : hasDatabasePrefix(id)
        ? "database"
        : hasMemberPrefix(id)
          ? "member"
          : "page")
  );
}
