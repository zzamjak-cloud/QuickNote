import { describe, expect, it, vi } from "vitest";
import { migrateBlockCommentStore } from "../blockCommentStore";
import { migrateDatabaseStore } from "../databaseStore";
import { migrateNotificationStore } from "../notificationStore";
import { migratePageStore } from "../pageStore";
import { migrateSettingsStore } from "../settingsStore";

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

  it("blockCommentStore migration normalizes mentions and drops invalid messages", () => {
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
          { id: "broken" },
        ],
        threadVisitedAt: {
          "p1:b1": "22",
          bad: "x",
        },
      },
      1,
    );

    expect(migrated.messages).toEqual([
      {
        id: "c1",
        workspaceId: null,
        pageId: "p1",
        blockId: "b1",
        authorMemberId: "author",
        bodyText: "body",
        mentionMemberIds: ["me"],
        parentId: null,
        createdAt: 11,
      },
    ]);
    expect(migrated.threadVisitedAt).toEqual({ "p1:b1": 22 });
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
});
