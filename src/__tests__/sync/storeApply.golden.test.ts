// Phase 5.3 — applyRemotePages/Databases 가 fixture 입력에 대해 결정적(deterministic) 인지 검증.
// 후속 리팩토링(분기별 적용기 분리 등) 후에도 결과가 동일해야 안전.
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

const WS = "ws-golden";
const NOW = "2026-05-22T00:00:00.000Z";

function gqlPage(id: string, order: number, parentId: string | null = null): GqlPage {
  return {
    id,
    workspaceId: WS,
    createdByMemberId: "mem",
    title: `T-${id}`,
    parentId,
    order: String(order),
    doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function gqlDb(id: string): GqlDatabase {
  return {
    id,
    workspaceId: WS,
    createdByMemberId: "mem",
    title: `DB-${id}`,
    columns: JSON.stringify([{ id: "title", name: "Name", type: "title" }]),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("storeApply golden snapshot (Phase 5.3)", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: WS, workspaces: [] });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    useHistoryStore.setState({
      pageEventsByPageId: {},
      dbEventsByDatabaseId: {},
      deletedRowTombstonesByDbId: {},
      cacheWorkspaceId: null,
    });
  });

  it("3 페이지 batch 적용 결과 — id/parentId/order/updatedAt 결정적", () => {
    applyRemotePagesToStore([
      gqlPage("p1", 1, null),
      gqlPage("p2", 2, "p1"),
      gqlPage("p3", 3, "p1"),
    ]);
    const pages = usePageStore.getState().pages;
    const snapshot = Object.values(pages)
      .map((p) => ({
        id: p.id,
        title: p.title,
        parentId: p.parentId,
        order: p.order,
        updatedAt: p.updatedAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "id": "p1",
          "order": 1,
          "parentId": null,
          "title": "T-p1",
          "updatedAt": 1779408000000,
        },
        {
          "id": "p2",
          "order": 2,
          "parentId": "p1",
          "title": "T-p2",
          "updatedAt": 1779408000000,
        },
        {
          "id": "p3",
          "order": 3,
          "parentId": "p1",
          "title": "T-p3",
          "updatedAt": 1779408000000,
        },
      ]
    `);
  });

  it("2 데이터베이스 batch 적용 결과 — meta id/title/updatedAt 결정적", () => {
    applyRemoteDatabasesToStore([gqlDb("d1"), gqlDb("d2")]);
    const databases = useDatabaseStore.getState().databases;
    const snapshot = Object.values(databases)
      .map((bundle) => ({
        id: bundle.meta.id,
        title: bundle.meta.title,
        updatedAt: bundle.meta.updatedAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "id": "d1",
          "title": "DB-d1",
          "updatedAt": 1779408000000,
        },
        {
          "id": "d2",
          "title": "DB-d2",
          "updatedAt": 1779408000000,
        },
      ]
    `);
  });

  it("동일 batch 를 두 번 적용해도 결과가 같다 (idempotent)", () => {
    const pages = [gqlPage("p1", 1), gqlPage("p2", 2)];
    applyRemotePagesToStore(pages);
    const first = JSON.stringify(usePageStore.getState().pages);
    applyRemotePagesToStore(pages);
    const second = JSON.stringify(usePageStore.getState().pages);
    expect(first).toBe(second);
  });
});
