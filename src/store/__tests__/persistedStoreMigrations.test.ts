import { describe, expect, it, vi } from "vitest";
import { migrateBlockCommentStore } from "../blockCommentStore";
import { migrateDatabaseStore } from "../databaseStore";
import { migrateNotificationStore } from "../notificationStore";
import { migratePageStore } from "../pageStore";
import { migrateSettingsStore } from "../settingsStore";
import { LC_SCHEDULER_DATABASE_ID } from "../../lib/scheduler/database";

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
});
