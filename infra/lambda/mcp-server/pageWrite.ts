// 페이지 저장·전파 — v5 upsertPage(데이터 안전 가드·히스토리·색인 포함) 후 publishPageChanged(IAM)로
// 열린 클라의 사이드바·메타를 갱신한다(template-automation runner 와 같은 경로).
import { upsertPage } from "../v5-resolvers/handlers/pageDatabase";
import { recordPageHistory } from "../v5-resolvers/handlers/pageDatabase/history";
import { publishPageChangedToAppSync } from "../template-automation/runner";
import { ResolverError } from "../v5-resolvers/handlers/_auth";
import { ToolError, type McpContext } from "./context";
import { getItem } from "./ddb";

type Item = Record<string, unknown>;

export type SavedPage = { page: Item; published: boolean };

export function nowIso(): string {
  return new Date().toISOString();
}

async function publish(page: Item): Promise<boolean> {
  try {
    await publishPageChangedToAppSync(page);
    return true;
  } catch (err) {
    // 저장은 끝났다 — 전파 실패는 다음 동기화(재진입·증분 sync)가 복구한다.
    console.error("mcp publishPageChanged 실패", { pageId: page.id }, err);
    return false;
  }
}

async function upsertAndPublish(ctx: McpContext, input: Item, expectedUpdatedAt?: string): Promise<SavedPage> {
  const page = await upsertPage({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: { ...input, lastEditSource: "mcp" },
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  });
  return { page, published: await publish(page) };
}

/** 신규 페이지 저장. lastEditedBy 는 upsertPage 가 caller(토큰 소유 멤버)로 기록한다. */
export async function saveNewPage(ctx: McpContext, input: Item): Promise<SavedPage> {
  return upsertAndPublish(ctx, input);
}

/** 바꿀 필드만. 함수면 저장 직전 최신 페이지를 받아 계산한다(예: 최신 dbCells 에 셀 병합). */
export type PagePatch = Item | ((latest: Item) => Item);

const PATCH_ATTEMPTS = 2;
export const CONCURRENT_MODIFICATION = "The page was modified concurrently; retry the request";

/**
 * 기존 페이지 부분 갱신 — 툴 시작 시점 스냅샷으로 전체 Put 하면 그 사이 사용자가 바꾼 제목·아이콘·parentId·dbCells 가
 * 되돌아가므로, 저장 직전 최신 항목을 다시 읽어 patch 필드만 덮고 updatedAt 조건부로 저장한다. 충돌 시 1회 재시도.
 */
export async function patchPage(ctx: McpContext, pageId: string, patch: PagePatch): Promise<SavedPage> {
  for (let attempt = 1; ; attempt += 1) {
    const latest = await getItem(ctx.doc, ctx.tables.Pages, { id: pageId });
    if (!latest || latest.deletedAt) throw new ToolError("The page was deleted or moved to the trash while editing");
    const fields = typeof patch === "function" ? patch(latest) : patch;
    const expected = typeof latest.updatedAt === "string" ? latest.updatedAt : undefined;
    try {
      return await upsertAndPublish(ctx, { ...latest, ...fields, updatedAt: nowIso() }, expected);
    } catch (err) {
      const conflict = err instanceof ResolverError && err.errorType === "Conflict";
      if (!conflict) throw err;
      if (attempt >= PATCH_ATTEMPTS) throw new ToolError(CONCURRENT_MODIFICATION);
    }
  }
}

/**
 * 본문 교체 전 버전 체크포인트 — 세션 머지 없이 새 히스토리 엔트리를 강제 기록해
 * 사용자가 버전 히스토리에서 교체 직전 상태로 복원할 수 있게 한다(savePageVersion 과 같은 kind).
 * doc 은 Pages.doc 스냅샷이 아니라 현재 협업 본문을 쓴다(8초 업서트 지연분까지 보존).
 */
export async function recordBodyCheckpoint(ctx: McpContext, page: Item, currentDoc: unknown): Promise<void> {
  const snapshot = { ...page, doc: JSON.stringify(currentDoc) };
  await recordPageHistory({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    before: snapshot,
    after: snapshot,
    kind: "page.checkpoint",
    force: true,
  });
}
