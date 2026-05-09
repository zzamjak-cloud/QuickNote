import { describe, expect, it } from "vitest";
import {
  EDITOR_UNIQUE_ID_TYPES,
  getFirstDatabaseBlockId,
  isFullPageDatabaseDoc,
  normalizeFullPageDatabaseDoc,
} from "../editorPolicy";
import type { JSONContent } from "@tiptap/react";

describe("block editor policy", () => {
  it("includes editable structural nodes for UniqueID and excludes media nodes", () => {
    expect(EDITOR_UNIQUE_ID_TYPES).toContain("paragraph");
    expect(EDITOR_UNIQUE_ID_TYPES).toContain("databaseBlock");
    expect(EDITOR_UNIQUE_ID_TYPES).toContain("tableCell");
    expect(EDITOR_UNIQUE_ID_TYPES).toContain("toggleHeader");
    expect(EDITOR_UNIQUE_ID_TYPES).toContain("pageLink");
    expect(EDITOR_UNIQUE_ID_TYPES).not.toContain("image");
    expect(EDITOR_UNIQUE_ID_TYPES).not.toContain("fileBlock");
    expect(EDITOR_UNIQUE_ID_TYPES).not.toContain("youtube");
  });

  it("detects full-page database docs", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "databaseBlock",
          attrs: { databaseId: "db-1", layout: "fullPage" },
        },
      ],
    };

    expect(isFullPageDatabaseDoc(doc)).toBe(true);
    expect(getFirstDatabaseBlockId(doc)).toBe("db-1");
  });

  it("normalizes extra content after a full-page database block", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "databaseBlock",
          attrs: { databaseId: "db-1", layout: "fullPage" },
        },
        { type: "paragraph" },
      ],
    };

    expect(normalizeFullPageDatabaseDoc(doc).content).toHaveLength(1);
  });
});
