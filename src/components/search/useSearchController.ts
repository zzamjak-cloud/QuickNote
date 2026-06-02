import { useEffect, useMemo, useState } from "react";
import { ensureSearchIndex, getIndexedRecords } from "../../lib/search/searchIndex";
import {
  searchWorkspace,
  sortByRelevance,
  sortByRecency,
  buildSnippetForPage,
  type PageHit,
  type DbHit,
} from "../../lib/search/searchEngine";
import type { SnippetHit } from "../../lib/search/buildSnippet";

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 10;

export type SnippetFeedItem = { hit: PageHit; snippet: SnippetHit | null };

export type SearchView = {
  query: string;
  setQuery: (q: string) => void;
  /** 인덱스 ensure 완료 여부(콜드 스타트 인덱싱 진행 표시용) */
  indexing: boolean;
  /** 좌측 리스트(관련도 정렬) 윈도우 + 전체 수 */
  leftItems: PageHit[];
  leftTotal: number;
  loadMoreLeft: () => void;
  /** 우측 스니펫 피드(최신순) 윈도우 + 전체 수 */
  feedItems: SnippetFeedItem[];
  feedTotal: number;
  loadMoreFeed: () => void;
  dbHits: DbHit[];
  /** 검색어 유무 — 빈 검색어면 최근 페이지를 보여주는 모드 */
  hasQuery: boolean;
};

export function useSearchController(): SearchView {
  const [query, setQuery] = useState("");
  const [indexing, setIndexing] = useState(true);
  const [tick, setTick] = useState(0); // 디바운스 후 검색 실행 트리거
  const [pageWindow, setPageWindow] = useState(PAGE_SIZE);
  const [feedWindow, setFeedWindow] = useState(PAGE_SIZE);

  const qLower = query.trim().toLowerCase();
  const hasQuery = qLower.length > 0;

  // 마운트 시 인덱스 ensure(콜드 스타트면 메모리에서 즉석 빌드)
  useEffect(() => {
    let alive = true;
    void ensureSearchIndex().then(() => {
      if (alive) setIndexing(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 입력 디바운스 → 인덱스 증분 갱신 후 검색 tick
  useEffect(() => {
    setPageWindow(PAGE_SIZE);
    setFeedWindow(PAGE_SIZE);
    if (!hasQuery) return;
    const t = setTimeout(() => {
      void ensureSearchIndex().then(() => setTick((n) => n + 1));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qLower, hasQuery]);

  // 검색어가 있으면 매칭 패스 실행, 없으면 최근 페이지(최신순) 노출
  const result = useMemo(() => {
    if (!hasQuery) {
      const recent: PageHit[] = getIndexedRecords()
        .map((r) => ({
          pageId: r.pageId,
          kind: r.kind,
          databaseId: r.databaseId,
          title: r.title,
          score: 0,
          updatedAt: r.updatedAt,
          matchedBody: false,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, PAGE_SIZE);
      return { pageHits: recent, dbHits: [] as DbHit[] };
    }
    return searchWorkspace(qLower);
    // tick 으로 디바운스 후 재계산을 강제
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQuery, qLower, tick]);

  const leftSorted = useMemo(
    () => sortByRelevance(result.pageHits),
    [result],
  );
  const feedSorted = useMemo(
    () => (hasQuery ? sortByRecency(result.pageHits.filter((h) => h.matchedBody)) : []),
    [result, hasQuery],
  );

  const leftItems = useMemo(
    () => leftSorted.slice(0, pageWindow),
    [leftSorted, pageWindow],
  );

  // 지연 스니펫 — 보이는 윈도우에 대해서만 생성
  const feedItems = useMemo<SnippetFeedItem[]>(
    () =>
      feedSorted.slice(0, feedWindow).map((hit) => ({
        hit,
        snippet: buildSnippetForPage(hit.pageId, qLower),
      })),
    [feedSorted, feedWindow, qLower],
  );

  return {
    query,
    setQuery,
    indexing,
    leftItems,
    leftTotal: leftSorted.length,
    loadMoreLeft: () => setPageWindow((n) => n + PAGE_SIZE),
    feedItems,
    feedTotal: feedSorted.length,
    loadMoreFeed: () => setFeedWindow((n) => n + PAGE_SIZE),
    dbHits: result.dbHits,
    hasQuery,
  };
}
