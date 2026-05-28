import { describe, expect, it, vi } from "vitest";
import { migrateBlockCommentStore } from "../blockCommentStore";
import { migrateDatabaseStore } from "../databaseStore";
import { migrateNotificationStore } from "../notificationStore";
import { migratePageStore } from "../pageStore";
import { migrateSettingsStore } from "../settingsStore";
import { LC_SCHEDULER_DATABASE_ID } from "../../lib/scheduler/database";
import {
  PAGE_STORE_DATA_KEYS,
  PAGE_STORE_PERSIST_VERSION,
} from "../pageStore/migrations";
import {
  DATABASE_STORE_DATA_KEYS,
  DATABASE_STORE_PERSIST_VERSION,
} from "../databaseStore/migrations";

describe("persisted store migrations", () => {
  it("settingsStore migration keeps existing prefs and adds missing fields", () => {
    vi.useFakeTimers().setSystemTime(123_000);
    const migrated = migrateSettingsStore(
      {
        darkMode: true,
        favoritePageIds: ["p1"],
        favoritePageIdsUpdatedAt: 0,
        favoritePageMetaById: [],
      },
      4,
    );

    expect(migrated.darkMode).toBe(true);
    expect(migrated.favoritePageIds).toEqual(["p1"]);
    expect(migrated.favoritePageMetaById).toEqual({});
    expect(migrated.lastVisitedPageIdByWorkspaceId).toEqual({});
    vi.useRealTimers();
  });

  it("notificationStore migration normalizes old mention ids and fills new fields", () => {
    const migrated = migrateNotificationStore(
      {
        items: [
          {
            id: "n1",
            recipientMemberId: "m:me",
            kind: "mention",
            pageId: "p1",
            blockId: "b1",
            fromMemberId: "m:author",
            commentId: "c1",
            previewBody: "hello",
            createdAt: 10,
            read: false,
          },
          { broken: true },
        ],
      },
      1,
    );

    expect(migrated.items).toEqual([
      {
        id: "n1",
        recipientMemberId: "me",
        kind: "mention",
        source: "comment",
        workspaceId: null,
        workspaceName: null,
        pageTitle: null,
        pageId: "p1",
        blockId: "b1",
        fromMemberId: "author",
        commentId: "c1",
        previewBody: "hello",
        createdAt: 10,
        read: false,
      },
    ]);
  });

  it("blockCommentStore migration은 messages를 비우고 threadVisitedAt을 빈 객체로 반환한다 (messages는 서버에서 재로드)", () => {
    const migrated = migrateBlockCommentStore(
      {
        messages: [
          {
            id: "c1",
            pageId: "p1",
            blockId: "b1",
            authorMemberId: "author",
            bodyText: "body",
            mentionMemberIds: ["m:me", "p:page"],
            parentId: undefined,
            createdAt: 11,
          },
        ],
        threadVisitedAt: { "p1:b1": "22" },
      },
      1,
    );

    expect(migrated.messages).toEqual([]);
    expect(migrated.threadVisitedAt).toEqual({});
  });

  it("pageStore migration preserves valid pages and quarantines invalid records", () => {
    const migrated = migratePageStore(
      {
        pages: {
          good: {
            id: "good",
            title: "Good",
            icon: null,
            doc: { type: "doc", content: [{ type: "paragraph" }] },
            parentId: null,
            order: 1,
            createdAt: 10,
            updatedAt: 20,
          },
          bad: { id: "bad" },
        },
        activePageId: "good",
      },
      2,
    );

    expect(Object.keys(migrated.pages as Record<string, unknown>)).toEqual([
      "good",
    ]);
    expect(migrated.activePageId).toBe("good");
    expect(migrated.migrationQuarantine).toEqual([
      expect.objectContaining({ reason: "invalid-page-records" }),
    ]);
  });

  it("databaseStore migration preserves valid databases and quarantines invalid records", () => {
    const migrated = migrateDatabaseStore(
      {
        databases: {
          db1: {
            meta: { id: "db1", title: "DB", createdAt: 1, updatedAt: 2 },
            columns: [{ id: "title", name: "Name", type: "title" }],
            rowPageOrder: ["p1"],
          },
          broken: { meta: { id: "broken" } },
        },
      },
      2,
    );

    expect(Object.keys(migrated.databases as Record<string, unknown>)).toEqual([
      "db1",
    ]);
    expect(migrated.migrationQuarantine).toEqual([
      expect.objectContaining({ reason: "invalid-database-records" }),
    ]);
  });

  it("databaseStore migration preserves advanced database column settings", () => {
    const migrated = migrateDatabaseStore(
      {
        databases: {
          db1: {
            meta: { id: "db1", title: "DB", createdAt: 1, updatedAt: 2 },
            columns: [
              { id: "title", name: "Name", type: "title" },
              {
                id: "select-source",
                name: "Status",
                type: "select",
                config: {
                  sourceFromDb: {
                    databaseId: "source-db",
                    columnId: "source-status",
                    automation: true,
                    viaPageLinkColumnId: "feature-link",
                  },
                },
              },
              {
                id: "item-fetch",
                name: "Feature",
                type: "itemFetch",
                config: {
                  itemFetchSourceDatabaseId: "feature-db",
                  itemFetchMatchColumnId: "task-link",
                },
              },
              {
                id: "page-link",
                name: "Task",
                type: "pageLink",
                config: {
                  pageLinkScopeDatabaseId: "task-db",
                  pageLinkAutoReverse: true,
                },
              },
            ],
            rowPageOrder: [],
          },
        },
      },
      3,
    );

    const db = (migrated.databases as Record<string, { columns: Array<{ id: string; type: string; config?: Record<string, unknown> }> }>).db1;
    expect(db.columns.map((column) => column.id)).toEqual([
      "title",
      "select-source",
      "item-fetch",
      "page-link",
    ]);
    expect(db.columns.find((column) => column.id === "select-source")?.config?.sourceFromDb).toEqual({
      databaseId: "source-db",
      columnId: "source-status",
      automation: true,
      viaPageLinkColumnId: "feature-link",
    });
    expect(db.columns.find((column) => column.id === "item-fetch")?.type).toBe("itemFetch");
    expect(db.columns.find((column) => column.id === "page-link")?.type).toBe("pageLink");
  });

  it("databaseStore migration removes legacy LC scheduler databases", () => {
    const migrated = migrateDatabaseStore(
      {
        databases: {
          [LC_SCHEDULER_DATABASE_ID]: {
            meta: { id: LC_SCHEDULER_DATABASE_ID, title: "LC스케줄러", createdAt: 1, updatedAt: 2 },
            columns: [{ id: "title", name: "Name", type: "title" }],
            rowPageOrder: [],
          },
          "lc-scheduler-db:personal-ws": {
            meta: { id: "lc-scheduler-db:personal-ws", title: "LC스케줄러", createdAt: 1, updatedAt: 3 },
            columns: [{ id: "title", name: "Name", type: "title" }],
            rowPageOrder: ["legacy-row"],
          },
        },
      },
      3,
    );

    expect(Object.keys(migrated.databases as Record<string, unknown>)).toEqual([
      LC_SCHEDULER_DATABASE_ID,
    ]);
  });

  it("pageStore migration removes pages linked to legacy LC scheduler databases", () => {
    const migrated = migratePageStore(
      {
        pages: {
          keep: {
            id: "keep",
            title: "Keep",
            icon: null,
            doc: { type: "doc", content: [{ type: "paragraph" }] },
            parentId: null,
            order: 1,
            databaseId: LC_SCHEDULER_DATABASE_ID,
            createdAt: 10,
            updatedAt: 20,
          },
          legacy: {
            id: "legacy",
            title: "Legacy",
            icon: null,
            doc: { type: "doc", content: [{ type: "paragraph" }] },
            parentId: null,
            order: 2,
            databaseId: "lc-scheduler-db:personal-ws",
            createdAt: 10,
            updatedAt: 20,
          },
        },
        activePageId: "legacy",
      },
      4,
    );

    expect(Object.keys(migrated.pages as Record<string, unknown>)).toEqual([
      "keep",
    ]);
    expect(migrated.activePageId).toBeNull();
  });

  // Phase 6 보강: 각 fromVersion 분기가 유효한 v 현재 상태를 반환하는지 검증
  it.each([0, 1, 2, 3, 4])(
    "pageStore migration fromVersion=%s 도 유효한 최신 상태로 정상 변환",
    (fromVersion) => {
      const migrated = migratePageStore(
        {
          pages: {
            sample: {
              id: "sample",
              title: "Sample",
              icon: null,
              doc: { type: "doc", content: [{ type: "paragraph" }] },
              parentId: null,
              order: 0,
              createdAt: 1,
              updatedAt: 2,
            },
          },
          activePageId: "sample",
        },
        fromVersion,
      );
      expect(migrated.pages).toBeDefined();
      expect((migrated.pages as Record<string, unknown>)["sample"]).toBeDefined();
      expect(migrated.activePageId).toBe("sample");
      expect(migrated.cacheWorkspaceId).toBeNull();
    },
  );

  it.each([0, 1, 2, 3])(
    "databaseStore migration fromVersion=%s 도 유효한 최신 상태로 정상 변환",
    (fromVersion) => {
      const migrated = migrateDatabaseStore(
        {
          databases: {
            db1: {
              meta: { id: "db1", title: "DB", createdAt: 1, updatedAt: 2 },
              columns: [{ id: "title", name: "Name", type: "title" }],
              rowPageOrder: [],
            },
          },
        },
        fromVersion,
      );
      expect(migrated.databases).toBeDefined();
      expect((migrated.databases as Record<string, unknown>)["db1"]).toBeDefined();
    },
  );

  // D5 CI 게이트: DATA_KEYS 또는 PERSIST_VERSION 변경 시 이 테스트가 fail 한다.
  // 변경 방법: 1) PERSIST_VERSION 을 올리고 2) 아래 스냅샷 기댓값도 함께 업데이트할 것.
  it("pageStore DATA_KEYS + PERSIST_VERSION 스냅샷 (버전 게이트)", () => {
    expect({
      version: PAGE_STORE_PERSIST_VERSION,
      keys: [...PAGE_STORE_DATA_KEYS],
    }).toEqual({
      version: 5,
      keys: ["pages", "activePageId", "cacheWorkspaceId", "migrationQuarantine"],
    });
  });

  it("databaseStore DATA_KEYS + PERSIST_VERSION 스냅샷 (버전 게이트)", () => {
    expect({
      version: DATABASE_STORE_PERSIST_VERSION,
      keys: [...DATABASE_STORE_DATA_KEYS],
    }).toEqual({
      version: 4,
      keys: ["databases", "cacheWorkspaceId", "migrationQuarantine", "dbTemplates"],
    });
  });
});
