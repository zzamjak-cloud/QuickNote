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
import { useDatabaseStore, listDatabases } from "../../store/databaseStore";
import type { SnippetHit } from "../../lib/search/buildSnippet";

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 10;

export type SnippetFeedItem = { hit: PageHit; snippet: SnippetHit | null };

export type SearchView = {
  /** 페이지 검색 필드 */
  pageQuery: string;
  setPageQuery: (q: string) => void;
  /** DB 검색 필드 */
  dbQuery: string;
  setDbQuery: (q: string) => void;
  /** 본문 하이라이트용(=페이지 검색어) */
  query: string;
  /** 인덱스 ensure 완료 여부(콜드 스타트 인덱싱 진행 표시용) */
  indexing: boolean;
  /** 좌측 페이지 리스트(관련도 정렬) 윈도우 + 전체 수 */
  leftItems: PageHit[];
  leftTotal: number;
  loadMoreLeft: () => void;
  /** 우측 스니펫 피드(최신순) 윈도우 + 전체 수 */
  feedItems: SnippetFeedItem[];
  feedTotal: number;
  loadMoreFeed: () => void;
  dbHits: DbHit[];
  /** 페이지 검색어 유무 — 빈 검색어면 최근 페이지를 보여주는 모드 */
  hasQuery: boolean;
};

export function useSearchController(): SearchView {
  const [pageQuery, setPageQuery] = useState("");
  const [dbQuery, setDbQuery] = useState("");
  const [indexing, setIndexing] = useState(true);
  const [tick, setTick] = useState(0); // 디바운스 후 검색 실행 트리거
  const [pageWindow, setPageWindow] = useState(PAGE_SIZE);
  const [feedWindow, setFeedWindow] = useState(PAGE_SIZE);

  const pageQLower = pageQuery.trim().toLowerCase();
  const dbQLower = dbQuery.trim().toLowerCase();
  const hasQuery = pageQLower.length > 0;
  const hasDbQuery = dbQLower.length > 0;

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
    if (!hasQuery && !hasDbQuery) return;
    const t = setTimeout(() => {
      void ensureSearchIndex().then(() => setTick((n) => n + 1));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pageQLower, dbQLower, hasQuery, hasDbQuery]);

  // 페이지 검색 — 검색어가 있으면 매칭, 없으면 최근 페이지(최신순)
  const pageHits = useMemo<PageHit[]>(() => {
    if (!hasQuery) {
      return getIndexedRecords()
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
    }
    return searchWorkspace(pageQLower).pageHits;
    // tick 으로 디바운스 후 재계산을 강제
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQuery, pageQLower, tick]);

  // DB 검색 — 검색어가 있으면 매칭, 없으면 최근 DB(최신순) 전체
  const dbHits = useMemo<DbHit[]>(() => {
    if (!hasDbQuery) {
      return listDatabases(useDatabaseStore.getState())
        .slice()
        .sort((a, b) => (b.meta.updatedAt ?? 0) - (a.meta.updatedAt ?? 0))
        .slice(0, PAGE_SIZE)
        .map((db) => ({ databaseId: db.id, title: db.meta.title, score: 0 }));
    }
    return searchWorkspace(dbQLower).dbHits;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDbQuery, dbQLower, tick]);

  const leftSorted = useMemo(() => sortByRelevance(pageHits), [pageHits]);
  const feedSorted = useMemo(
    () => (hasQuery ? sortByRecency(pageHits.filter((h) => h.matchedBody)) : []),
    [pageHits, hasQuery],
  );

  const leftItems = useMemo(() => leftSorted.slice(0, pageWindow), [leftSorted, pageWindow]);

  // 지연 스니펫 — 보이는 윈도우에 대해서만 생성
  const feedItems = useMemo<SnippetFeedItem[]>(
    () =>
      feedSorted.slice(0, feedWindow).map((hit) => ({
        hit,
        snippet: buildSnippetForPage(hit.pageId, pageQLower),
      })),
    [feedSorted, feedWindow, pageQLower],
  );

  return {
    pageQuery,
    setPageQuery,
    dbQuery,
    setDbQuery,
    query: pageQuery,
    indexing,
    leftItems,
    leftTotal: leftSorted.length,
    loadMoreLeft: () => setPageWindow((n) => n + PAGE_SIZE),
    feedItems,
    feedTotal: feedSorted.length,
    loadMoreFeed: () => setFeedWindow((n) => n + PAGE_SIZE),
    dbHits,
    hasQuery,
  };
}
