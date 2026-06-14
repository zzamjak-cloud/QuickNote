/**
 * 버전 히스토리용 블럭 단위 diff.
 *
 * 두 doc(JSON 또는 JSON 문자열)의 최상위 블럭을 TipTap uniqueId(attrs.id)로 매칭해
 * added / removed / modified 를 가려낸다. 서버(historySession.ts)와 동일 규칙:
 * - 빈 문단의 추가/삭제는 변화가 아니다.
 * - 내용이 같은 블럭의 위치 이동(밀림)은 변화가 아니다.
 * - attrs.id 가 없는 레거시 블럭은 내용 시그니처로 매칭한다(수정은 삭제+추가로 보임).
 */

import { isRecord } from "../util/typeGuards";
import {
  blockSignature,
  hashString,
  isEmptyBlockNode,
  parseJsonLike,
} from "./signatureCore";

export { isEmptyBlockNode } from "./signatureCore";

export type BlockNode = Record<string, unknown>;

export type BlockDiffEntry = {
  /** 블럭 식별 키 — attrs.id 또는 시그니처 해시("sig-…"). changedUnits 의 "block:<id>" 와 동일 키. */
  id: string;
  kind: "added" | "removed" | "modified";
  before: BlockNode | null;
  after: BlockNode | null;
};

type CollectedBlock = { id: string; sig: string; empty: boolean; node: BlockNode; index: number };

function collectBlocks(docValue: unknown): CollectedBlock[] {
  const doc = parseJsonLike(docValue);
  if (!isRecord(doc) || !Array.isArray(doc.content)) return [];
  const out: CollectedBlock[] = [];
  doc.content.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const sig = blockSignature(raw);
    const attrs = raw.attrs;
    const id =
      isRecord(attrs) && typeof attrs.id === "string" && attrs.id
        ? attrs.id
        : `sig-${hashString(sig)}`;
    out.push({ id, sig, empty: isEmptyBlockNode(raw), node: raw, index });
  });
  return out;
}

/** before→after 블럭 diff. after 문서 순서대로 added/modified, 그 뒤에 removed(원래 순서). */
export function diffDocBlocks(beforeDoc: unknown, afterDoc: unknown): BlockDiffEntry[] {
  const beforeBlocks = collectBlocks(beforeDoc);
  const afterBlocks = collectBlocks(afterDoc);
  const beforeById = new Map(beforeBlocks.map((b) => [b.id, b]));
  const afterIds = new Set(afterBlocks.map((b) => b.id));
  const out: BlockDiffEntry[] = [];
  for (const block of afterBlocks) {
    const prev = beforeById.get(block.id);
    if (!prev) {
      if (!block.empty) {
        out.push({ id: block.id, kind: "added", before: null, after: block.node });
      }
      continue;
    }
    if (prev.sig !== block.sig) {
      out.push({ id: block.id, kind: "modified", before: prev.node, after: block.node });
    }
  }
  for (const block of beforeBlocks) {
    if (afterIds.has(block.id)) continue;
    if (block.empty) continue;
    out.push({ id: block.id, kind: "removed", before: block.node, after: null });
  }
  return out;
}

const META_UNIT_LABELS: Record<string, string> = {
  "meta:title": "제목",
  "meta:titleColor": "제목 색상",
  "meta:icon": "아이콘",
  "meta:coverImage": "커버",
  "meta:parent": "위치 이동",
  "meta:delete": "삭제",
};

/** changedUnits 키 목록을 목록 라벨용 한 줄 요약으로. 예: "블럭 3개 · 셀 1개 · 제목" */
export function summarizeChangedUnits(units: unknown): string {
  const list = Array.isArray(parseJsonLike(units))
    ? (parseJsonLike(units) as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  if (list.length === 0) return "";
  const blocks = list.filter((u) => u.startsWith("block:")).length;
  const cells = list.filter((u) => u.startsWith("cell:")).length;
  const columns = list.filter((u) => u.startsWith("column:")).length;
  const presets = list.filter((u) => u.startsWith("preset:")).length;
  const parts: string[] = [];
  if (blocks > 0) parts.push(`블럭 ${blocks}개`);
  if (cells > 0) parts.push(`셀 ${cells}개`);
  if (columns > 0) parts.push(`컬럼 ${columns}개`);
  if (presets > 0) parts.push(`뷰 ${presets}개`);
  if (list.includes("columns")) parts.push("컬럼");
  if (list.includes("presets")) parts.push("뷰");
  if (list.includes("templates")) parts.push("템플릿");
  for (const [unit, label] of Object.entries(META_UNIT_LABELS)) {
    if (list.includes(unit)) parts.push(label);
  }
  return parts.join(" · ");
}

/** 세션 contributors(AWSJSON) 파싱 — 표시용. */
export function parseContributors(value: unknown): Array<{ memberId: string; name: string | null }> {
  const raw = parseJsonLike(value);
  if (!Array.isArray(raw)) return [];
  const out: Array<{ memberId: string; name: string | null }> = [];
  for (const item of raw) {
    if (isRecord(item) && typeof item.memberId === "string" && item.memberId) {
      out.push({ memberId: item.memberId, name: typeof item.name === "string" ? item.name : null });
    }
  }
  return out;
}

/** changedUnits(AWSJSON) 파싱. */
export function parseChangedUnits(value: unknown): string[] {
  const raw = parseJsonLike(value);
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string");
}
