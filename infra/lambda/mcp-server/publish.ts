// 열린 클라로의 변경 전파 — IAM 전용 publish*Changed mutation 을 호출해 onPageChanged·onDatabaseChanged·
// onCommentChanged 구독을 발행한다(클라 구독·스키마 파싱 그대로, 클라 변경 없음).
// 실패는 저장 결과를 바꾸지 않는다 — 다음 동기화(델타 fetch·재진입)가 복구하므로 로그만 남기고 false.
import { postAppSyncIam } from "../_shared/appsyncIam";
import { toPublishPageChangedInput } from "../template-automation/runner";

type Item = Record<string, unknown>;

const PAGE_FIELDS = `id workspaceId createdByMemberId title titleColor icon coverImage parentId order databaseId
  fullPageDatabaseId lastEditedByMemberId lastEditedByName createdAt updatedAt deletedAt`;
const DATABASE_FIELDS = "id workspaceId createdByMemberId title columns presets panelState templates templatesUpdatedAt createdAt updatedAt deletedAt";
const COMMENT_FIELDS = "id workspaceId pageId blockId authorMemberId bodyText mentionMemberIds reactions parentId createdAt updatedAt deletedAt";

const PUBLISH_PAGE = `mutation PublishPageChanged($input: PageInput!, $deletedAt: AWSDateTime) {
  publishPageChanged(input: $input, deletedAt: $deletedAt) { ${PAGE_FIELDS} }
}`;
const PUBLISH_DATABASE = `mutation PublishDatabaseChanged($input: DatabaseInput!) {
  publishDatabaseChanged(input: $input) { ${DATABASE_FIELDS} }
}`;
const PUBLISH_COMMENT = `mutation PublishCommentChanged($input: CommentInput!) {
  publishCommentChanged(input: $input) { ${COMMENT_FIELDS} }
}`;

function json(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function attempt(kind: string, id: unknown, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`mcp publish${kind}Changed 실패`, { id }, err);
    return false;
  }
}

/**
 * 페이지 메타 전파. deletedAt 을 주면 구독 클라가 tombstone 으로 처리해 목록에서 제거한다.
 * onPageChanged 는 메타 필드만 구독하므로 본문·셀·댓글은 싣지 않는다(placeholder) — 대용량 본문 페이로드 한도 회피.
 */
export function publishPage(page: Item, opts: { deletedAt?: string } = {}): Promise<boolean> {
  const input = toPublishPageChangedInput({ ...page, doc: null, dbCells: null, blockComments: null });
  return attempt("Page", page.id, () => postAppSyncIam(PUBLISH_PAGE, { input, deletedAt: opts.deletedAt ?? null }));
}

export function toPublishDatabaseInput(db: Item): Item {
  return {
    id: db.id,
    workspaceId: db.workspaceId,
    createdByMemberId: db.createdByMemberId ?? null,
    title: db.title ?? "",
    columns: json(db.columns) ?? "[]",
    presets: json(db.presets),
    panelState: json(db.panelState),
    templates: json(db.templates),
    templatesUpdatedAt: db.templatesUpdatedAt ?? null,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

export function publishDatabase(db: Item): Promise<boolean> {
  return attempt("Database", db.id, () => postAppSyncIam(PUBLISH_DATABASE, { input: toPublishDatabaseInput(db) }));
}

export function publishComment(comment: Item): Promise<boolean> {
  const input = {
    id: comment.id,
    workspaceId: comment.workspaceId,
    pageId: comment.pageId,
    blockId: comment.blockId,
    authorMemberId: comment.authorMemberId,
    bodyText: comment.bodyText,
    mentionMemberIds: json(comment.mentionMemberIds) ?? "[]",
    reactions: json(comment.reactions),
    parentId: comment.parentId ?? null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
  return attempt("Comment", comment.id, () => postAppSyncIam(PUBLISH_COMMENT, { input }));
}
