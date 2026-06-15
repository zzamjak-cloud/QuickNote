// pageStore 내부 헬퍼 — sync enqueue, doc walker, snapshot, tree util.
// pageStore.ts 에서 분리 — 동작 변경 없음.

import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../../types/page";
import type { PageSnapshot } from "../../types/history";
import { enqueueAsync } from "../../lib/sync/runtime";
import { toUpsertPageInput } from "../../lib/sync/mappers/upsertPageInput";
import {
  isLCSchedulerDatabaseId,
  isLCMilestoneDatabaseId,
  isLCFeatureDatabaseId,
  LC_SCHEDULER_DATABASE_ID,
} from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { useAuthStore } from "../authStore";
import { useMemberStore } from "../memberStore";
import { useWorkspaceStore } from "../workspaceStore";
import { isDbCollabActive } from "../../lib/collab/dbCollabRegistry";

export const MAX_UPSERT_PAGE_PAYLOAD_BYTES = 350 * 1024;
export const META_ONLY_PAGE_UPSERT_FLAG = "__metaOnly";

// 동기화 헬퍼 — v5 에서는 workspaceId 스코핑 + 작성자 식별자(createdByMemberId)가 필요.
// 현재는 auth sub 를 createdByMemberId fallback 으로 사용한다.
export function getCreatedByMemberId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

export function getCurrentMemberId(): string {
  return useMemberStore.getState().me?.memberId ?? getCreatedByMemberId();
}

export function getCurrentWorkspaceId(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "";
}

function resolvePageWorkspaceId(p: Page): string {
  const dbId = p.databaseId;
  if (isLCSchedulerDatabaseId(dbId) || isLCMilestoneDatabaseId(dbId) || isLCFeatureDatabaseId(dbId)) {
    return LC_SCHEDULER_WORKSPACE_ID;
  }
  return p.workspaceId ?? getCurrentWorkspaceId();
}

function normalizePageDatabaseId(databaseId: string | null | undefined): string | null {
  if (!databaseId) return null;
  if (isLCSchedulerDatabaseId(databaseId)) return LC_SCHEDULER_DATABASE_ID;
  return databaseId;
}

// 클라이언트 number(epoch ms) → GraphQL 경계 string/ISO 변환.
// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다 — 객체를 그대로 보내면
// 'Variable has an invalid value' 검증 오류로 mutation 이 거부된다.
export function toGqlPage(p: Page, createdByMemberId: string): Record<string, unknown> {
  // 이 경로는 titleColor/coverImage/fullPageDatabaseId 를 포함하고,
  // dbCells 협업 제어는 enqueueUpsertPage 가 매핑 이후 별도로 처리한다.
  return toUpsertPageInput(p, createdByMemberId, {
    workspaceId: resolvePageWorkspaceId(p),
    databaseId: normalizePageDatabaseId(p.databaseId),
    dbCells: p.dbCells ? JSON.stringify(p.dbCells) : null,
    includeMetaColors: true,
    includeFullPageDatabaseId: true,
  });
}

export function payloadByteLength(payload: Record<string, unknown>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function enqueueUpsertPage(p: Page, opts?: { includeCells?: boolean; metaOnly?: boolean }): void {
  // 인증/부트스트랩 미완료 시점에 enqueue 되면 서버 검증에서 거부되어 outbox 에 stale 로 남는다.
  const workspaceId = resolvePageWorkspaceId(p);
  if (!workspaceId) {
    console.warn("[sync] upsertPage skipped: workspaceId 미설정", { pageId: p.id });
    return;
  }
  const payload = toGqlPage(p, getCreatedByMemberId()) as Record<string, unknown> & {
    id: string;
    updatedAt?: string;
  };
  if (opts?.metaOnly) {
    payload[META_ONLY_PAGE_UPSERT_FLAG] = true;
    payload.doc = structuredClone(EMPTY_DOC);
    delete payload.dbCells;
  }
  // 협업 ON DB 행 페이지: 셀 권위는 Y.Doc. 비셀 변경발 upsert 는 dbCells 제외.
  if (!opts?.metaOnly && p.databaseId && isDbCollabActive(p.databaseId) && !opts?.includeCells) {
    payload.dbCells = null;
  }
  const bytes = payloadByteLength(payload);
  if (bytes > MAX_UPSERT_PAGE_PAYLOAD_BYTES) {
    console.warn("[sync] upsertPage skipped: payload too large", {
      pageId: p.id,
      bytes,
      limit: MAX_UPSERT_PAGE_PAYLOAD_BYTES,
    });
    return;
  }
  enqueueAsync("upsertPage", payload);
}

/** href 에서 pageId 를 추출 — HTTP URL (?page=xxx) 과 quicknote://page/xxx 스킴 모두 처리 */
export function extractPageIdFromHref(href: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    const qp = url.searchParams.get("page");
    if (qp) return qp;
    if (url.protocol === "quicknote:" && url.hostname === "page") {
      return url.pathname.replace(/^\/+/, "") || null;
    }
  } catch {
    const m = href.match(/[?&]page=([^&]+)/);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

export function updateButtonLabelsInDoc(
  node: JSONContent,
  homePageId: string,
  newLabel: string,
  markDirty: () => void,
): JSONContent {
  if (
    node.type === "buttonBlock" &&
    extractPageIdFromHref(node.attrs?.href ?? "") === homePageId
  ) {
    markDirty();
    return { ...node, attrs: { ...node.attrs, label: newLabel } };
  }
  if (!node.content?.length) return node;
  const newContent = node.content.map((c) =>
    updateButtonLabelsInDoc(c, homePageId, newLabel, markDirty),
  );
  if (newContent.every((c, i) => c === node.content![i])) return node;
  return { ...node, content: newContent };
}

export function jsonText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (node.type === "mention") {
    return "";
  }
  const own = typeof node.text === "string" ? node.text : "";
  const child = node.content?.map(jsonText).join(" ") ?? "";
  return `${own} ${child}`.replace(/\s+/g, " ").trim();
}

export function blockPreviewById(doc: JSONContent, blockId: string): string {
  let found = "";
  const walk = (node: JSONContent | null | undefined): boolean => {
    if (!node) return false;
    if (node.attrs && node.attrs.id === blockId) {
      found = jsonText(node);
      return true;
    }
    for (const child of node.content ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(doc);
  return found;
}

export const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function nextOrderForParent(pages: PageMap, parentId: string | null): number {
  const siblings = Object.values(pages).filter((p) => p.parentId === parentId);
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((s) => s.order)) + 1;
}

export function toPageSnapshot(page: Page): PageSnapshot {
  return {
    id: page.id,
    title: page.title,
    titleColor: page.titleColor ?? null,
    icon: page.icon,
    doc: structuredClone(page.doc),
    parentId: page.parentId,
    order: page.order,
    databaseId: page.databaseId,
    dbCells: page.dbCells ? structuredClone(page.dbCells) : undefined,
    blockComments: page.blockComments
      ? structuredClone(page.blockComments)
      : undefined,
  };
}

export function isDescendant(
  pages: PageMap,
  candidateAncestorId: string,
  nodeId: string,
): boolean {
  let cursor: string | null = nodeId;
  while (cursor) {
    if (cursor === candidateAncestorId) return true;
    cursor = pages[cursor]?.parentId ?? null;
  }
  return false;
}

/** 표시용 제목 정규화 — 비교·중복 검사에 공통 사용 */
export function normalizePageTitle(title: string): string {
  return title.trim() || "제목 없음";
}

function isPageSoftDeleted(page: Page): boolean {
  return Boolean((page as { deletedAt?: string | null }).deletedAt);
}

function pageInWorkspace(page: Page, workspaceId: string | undefined): boolean {
  return (page.workspaceId ?? "") === (workspaceId ?? "");
}

export function isPageTitleTaken(
  pages: PageMap,
  title: string,
  opts?: { exceptId?: string; workspaceId?: string; reservedTitles?: Set<string> },
): boolean {
  const normalized = normalizePageTitle(title);
  if (opts?.reservedTitles?.has(normalized)) return true;
  const exceptId = opts?.exceptId ?? "";
  const workspaceId = opts?.workspaceId;
  for (const [id, page] of Object.entries(pages)) {
    if (id === exceptId) continue;
    if (isPageSoftDeleted(page)) continue;
    if (workspaceId !== undefined && !pageInWorkspace(page, workspaceId)) continue;
    if (normalizePageTitle(page.title) === normalized) return true;
  }
  return false;
}

/** 신규 페이지용 — 워크스페이스 내 기존 제목과 겹치지 않는 제목 */
export function allocateUniquePageTitle(
  pages: PageMap,
  preferred: string,
  opts?: {
    workspaceId?: string;
    exceptId?: string;
    reservedTitles?: Set<string>;
  },
): string {
  const base = normalizePageTitle(preferred);
  if (!isPageTitleTaken(pages, base, opts)) return base;
  let n = 1;
  while (isPageTitleTaken(pages, `${base} (${n})`, opts)) {
    n += 1;
  }
  return `${base} (${n})`;
}

/** 워크스페이스 복제 등 — 대상 WS 의 기존 페이지 제목 인덱스 */
export function collectWorkspacePages(
  pages: PageMap,
  workspaceId: string,
): PageMap {
  const out: PageMap = {};
  for (const [id, page] of Object.entries(pages)) {
    if (isPageSoftDeleted(page)) continue;
    if (!pageInWorkspace(page, workspaceId)) continue;
    out[id] = page;
  }
  return out;
}

export function mergeRemotePageMetasIntoMap(
  target: PageMap,
  metas: Array<{ id: string; title: string; deletedAt?: string | null }>,
  workspaceId: string,
): void {
  for (const meta of metas) {
    if (meta.deletedAt) continue;
    if (target[meta.id]) continue;
    target[meta.id] = {
      id: meta.id,
      title: meta.title,
      icon: null,
      doc: structuredClone(EMPTY_DOC),
      parentId: null,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
      workspaceId,
    };
  }
}

export const PAGE_TITLE_DUPLICATE_MESSAGE =
  "이미 같은 이름의 페이지가 있습니다. 다른 이름을 입력해 주세요.";

export function preparePageTitleInput(draft: string): string {
  return normalizePageTitle(draft);
}

/** 사이드바·+ 버튼 등 기본 생성 제목 — "새 페이지 (1)" 형태 포함 */
export function isDefaultNewPageTitle(title: string): boolean {
  return /^새 페이지(?: \(\d+\))?$/.test(title.trim());
}
