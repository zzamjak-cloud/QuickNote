// pageStore 내부 헬퍼 — sync enqueue, doc walker, snapshot, tree util.
// pageStore.ts 에서 분리 — 동작 변경 없음.

import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../../types/page";
import type { PageSnapshot } from "../../types/history";
import { enqueueAsync } from "../../lib/sync/runtime";
import { useAuthStore } from "../authStore";
import { useMemberStore } from "../memberStore";
import { useWorkspaceStore } from "../workspaceStore";

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

// 클라이언트 number(epoch ms) → GraphQL 경계 string/ISO 변환.
// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다 — 객체를 그대로 보내면
// 'Variable has an invalid value' 검증 오류로 mutation 이 거부된다.
export function toGqlPage(p: Page, createdByMemberId: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: p.id,
    workspaceId: getCurrentWorkspaceId(),
    createdByMemberId,
    title: p.title,
    icon: p.icon ?? null,
    coverImage: p.coverImage ?? null,
    parentId: p.parentId ?? null,
    order: String(p.order),
    databaseId: p.databaseId ?? null,
    doc: JSON.stringify(p.doc),
    dbCells: p.dbCells ? JSON.stringify(p.dbCells) : null,
    createdAt: new Date(p.createdAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
  return base;
}

export function enqueueUpsertPage(p: Page): void {
  // 인증/부트스트랩 미완료 시점에 enqueue 되면 서버 검증에서 거부되어 outbox 에 stale 로 남는다.
  if (!getCurrentWorkspaceId()) {
    console.warn("[sync] upsertPage skipped: workspaceId 미설정", { pageId: p.id });
    return;
  }
  enqueueAsync(
    "upsertPage",
    toGqlPage(p, getCreatedByMemberId()) as unknown as Record<string, unknown> & {
      id: string;
      updatedAt?: string;
    },
  );
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
