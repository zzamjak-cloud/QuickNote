// Phase 0 baseline 성능 테스트.
// Phase 5 storeApply 리팩토링 후 동일 fixture 로 비교하기 위한 측정용.
// 본 테스트는 단순 회귀 게이트(>=0) 만 검증하며, 실제 시간은 console.info 로 기록한다.
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyRemotePagesToStore,
  applyRemoteDatabasesToStore,
} from "../../lib/sync/storeApply";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useHistoryStore } from "../../store/historyStore";
import type { GqlDatabase, GqlPage } from "../../lib/sync/graphql/operations";

const WS = "ws-perf";

function makePage(i: number): GqlPage {
  const now = new Date().toISOString();
  return {
    id: `pg-${i}`,
    workspaceId: WS,
    createdByMemberId: "mem",
    title: `Page ${i}`,
    order: String(i),
    doc: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `content ${i}` }] },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  };
}

function makeDatabase(i: number): GqlDatabase {
  const now = new Date().toISOString();
  return {
    id: `db-${i}`,
    workspaceId: WS,
    createdByMemberId: "mem",
    title: `DB ${i}`,
    columns: "[]",
    createdAt: now,
    updatedAt: now,
  };
}

function makePages(count: number): GqlPage[] {
  return Array.from({ length: count }, (_, i) => makePage(i));
}

function makeDatabases(count: number): GqlDatabase[] {
  return Array.from({ length: count }, (_, i) => makeDatabase(i));
}

describe("storeApply 성능 baseline (Phase 0)", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: WS, workspaces: [] });
    usePageStore.setState({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: null,
    });
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    useHistoryStore.setState({
      pageEventsByPageId: {},
      dbEventsByDatabaseId: {},
      deletedRowTombstonesByDbId: {},
      cacheWorkspaceId: null,
    });
  });

  it("applyRemotePagesToStore (1000 pages) wall-clock 측정", () => {
    const pages = makePages(1000);
    const t0 = performance.now();
    applyRemotePagesToStore(pages);
    const elapsed = performance.now() - t0;
     
    console.info(`[perf-baseline] applyRemotePagesToStore(1000) = ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1000);
  });

  it("applyRemoteDatabasesToStore (50 databases) wall-clock 측정", () => {
    const dbs = makeDatabases(50);
    const t0 = performance.now();
    applyRemoteDatabasesToStore(dbs);
    const elapsed = performance.now() - t0;
     
    console.info(`[perf-baseline] applyRemoteDatabasesToStore(50) = ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(Object.keys(useDatabaseStore.getState().databases).length).toBe(50);
  });

  it("page + database 혼합 적용 wall-clock 측정", () => {
    const pages = makePages(1000);
    const dbs = makeDatabases(50);
    const t0 = performance.now();
    applyRemotePagesToStore(pages);
    applyRemoteDatabasesToStore(dbs);
    const elapsed = performance.now() - t0;
     
    console.info(`[perf-baseline] mixed(1000p+50db) = ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
