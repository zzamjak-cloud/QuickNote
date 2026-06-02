import { koreanMatchOffset, koreanMatchScore } from "../koreanSearch";
import { useDatabaseStore, listDatabases } from "../../store/databaseStore";
import { getIndexedRecords, getIndexedRecord } from "./searchIndex";
import { findBestSnippet, type SnippetHit } from "./buildSnippet";

/** 좌측 리스트/우측 피드 공용 페이지 히트(스니펫은 아직 만들지 않음 — 2단계 중 1단계 결과) */
export type PageHit = {
  pageId: string;
  kind: "page" | "db-row";
  databaseId: string | null;
  title: string;
  score: number;
  updatedAt: number;
  /** 본문(블록/셀)에 매치가 있는가 → 스니펫 피드 후보 여부 */
  matchedBody: boolean;
};

export type DbHit = {
  databaseId: string;
  title: string;
  score: number;
};

export type SearchResult = {
  /** 전체 페이지 히트(좌측 리스트는 score, 우측 피드는 recency 로 각각 정렬해 사용) */
  pageHits: PageHit[];
  dbHits: DbHit[];
};

const TITLE_BASE = 10_000;
const BODY_SCORE = 400;

/**
 * 1단계: 캐시된 소문자 본문에 대해 점수만 계산(스니펫 생성 없음).
 * 제목은 koreanMatchScore(초성 포함) 전체 경로, 본문은 koreanMatchOffset(저비용 substring) 경로.
 */
export function searchWorkspace(queryLower: string): SearchResult {
  const q = queryLower.trim();
  if (!q) return { pageHits: [], dbHits: [] };

  const pageHits: PageHit[] = [];
  for (const rec of getIndexedRecords()) {
    const titleScore = koreanMatchScore(rec.titleLower, q);
    const matchedBody = koreanMatchOffset(rec.searchableLower, q) >= 0;
    if (titleScore <= 0 && !matchedBody) continue;
    const score = (titleScore > 0 ? TITLE_BASE + titleScore : 0) + (matchedBody ? BODY_SCORE : 0);
    pageHits.push({
      pageId: rec.pageId,
      kind: rec.kind,
      databaseId: rec.databaseId,
      title: rec.title,
      score,
      updatedAt: rec.updatedAt,
      matchedBody,
    });
  }

  // DB 자체(이름) — 개수가 적어 직접 매칭
  const dbHits: DbHit[] = [];
  for (const db of listDatabases(useDatabaseStore.getState())) {
    const score = koreanMatchScore(db.meta.title.toLowerCase(), q);
    if (score > 0) dbHits.push({ databaseId: db.id, title: db.meta.title, score });
  }
  dbHits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return { pageHits, dbHits };
}

/** 좌측 리스트 정렬 — 관련도 우선, 동점 시 최신순 */
export function sortByRelevance(hits: PageHit[]): PageHit[] {
  return hits.slice().sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
}

/** 우측 스니펫 피드 정렬 — 스펙대로 최신 수정일 우선 */
export function sortByRecency(hits: PageHit[]): PageHit[] {
  return hits.slice().sort((a, b) => b.updatedAt - a.updatedAt || b.score - a.score);
}

/**
 * 2단계: 화면에 보일 페이지에 대해서만 스니펫을 생성한다(지연 생성).
 * 본문 매치인데 블록에서 스니펫을 못 찾으면 첫 블록을 폴백으로 보여줘 피드에서 사라지지 않게 한다.
 */
export function buildSnippetForPage(pageId: string, queryLower: string): SnippetHit | null {
  const rec = getIndexedRecord(pageId);
  if (!rec) return null;
  const hit = findBestSnippet(rec.blocks, queryLower);
  if (hit) return hit;
  const first = rec.blocks[0];
  if (!first) return null;
  const text = first.text.slice(0, 120);
  return {
    snippet: { before: "", match: "", after: text + (first.text.length > 120 ? "…" : "") },
    blockRef: { blockId: first.blockId, blockIndex: first.blockIndex },
  };
}
