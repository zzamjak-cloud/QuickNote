import type { JSONContent } from "@tiptap/react";
import type { Page } from "../../types/page";
import { collectNodeText } from "./tiptapText";

/** 검색 인덱스의 블록 단위 텍스트 — 네비게이션(blockId/blockIndex)과 스니펫에 사용 */
export type BlockText = {
  /** 문서 내 top-level 블록 0-based 순서 */
  blockIndex: number;
  /** UniqueID(attrs.id) 가 있으면 보존 — 없으면 null(이동 시 blockIndex 폴백) */
  blockId: string | null;
  /** 블록의 평문(원본 대소문자 유지 — 스니펫 표시용) */
  text: string;
};

/** 페이지 1건의 추출 결과 — searchIndex 에 저장되는 단위 */
export type PageSearchRecord = {
  pageId: string;
  workspaceId: string | null;
  kind: "page" | "db-row";
  databaseId: string | null;
  title: string;
  blocks: BlockText[];
  updatedAt: number;
};

/** DB 셀 값을 검색 가능한 평문으로 환원(타입에 의존하지 않는 방어적 직렬화) */
function cellValueToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(cellValueToText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // 자주 쓰이는 표시용 필드 우선 추출(파일명/라벨/날짜 범위 등)
    const candidates = [obj.name, obj.label, obj.title, obj.text, obj.start, obj.end];
    const picked = candidates.filter((v) => typeof v === "string" && v).join(" ");
    return picked;
  }
  return "";
}

/**
 * 페이지 doc(TipTap JSON)을 top-level 블록 단위로 분해해 평문 블록 배열을 만든다.
 * DB 행 페이지는 셀 값들도 추가 블록으로 붙여 본문처럼 검색되게 한다.
 */
export function extractPageSearchRecord(page: Page): PageSearchRecord {
  const blocks: BlockText[] = [];
  const topLevel: JSONContent[] = page.doc?.content ?? [];
  topLevel.forEach((node, index) => {
    const text = collectNodeText(node).trim();
    if (!text) return;
    const blockId = typeof node.attrs?.id === "string" ? (node.attrs.id as string) : null;
    blocks.push({ blockIndex: index, blockId, text });
  });

  // DB 행 셀 값 — blockIndex 는 본문 다음 번호로 이어 붙인다(이동 시에는 blockId 없음 → 페이지만 열림)
  if (page.dbCells) {
    let cellIndex = topLevel.length;
    for (const raw of Object.values(page.dbCells)) {
      const text = cellValueToText(raw).trim();
      if (!text) continue;
      blocks.push({ blockIndex: cellIndex++, blockId: null, text });
    }
  }

  return {
    pageId: page.id,
    workspaceId: page.workspaceId ?? null,
    kind: page.databaseId ? "db-row" : "page",
    databaseId: page.databaseId ?? null,
    title: page.title ?? "",
    blocks,
    updatedAt: page.updatedAt ?? 0,
  };
}
