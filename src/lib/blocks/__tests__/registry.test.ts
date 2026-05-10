import { describe, expect, it } from "vitest";
import {
  blockDefinitions,
  getBlockDefinition,
  getBlockDefinitionForNodeType,
  getSlashMenuEntries,
} from "../registry";
import type {
  SlashLeafItem,
  SlashMenuEntry,
} from "../../tiptapExtensions/slashMenu/types";

function flattenSlashEntries(entries: SlashMenuEntry[]): SlashLeafItem[] {
  const leaves: SlashLeafItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "leaf") {
      leaves.push(entry);
    } else {
      leaves.push(...entry.children);
    }
  }
  return leaves;
}

describe("block registry", () => {
  it("uses unique block ids and node types", () => {
    const ids = blockDefinitions.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);

    const nodeTypes = blockDefinitions.flatMap((definition) => definition.nodeTypes);
    expect(new Set(nodeTypes).size).toBe(nodeTypes.length);
  });

  it("indexes definitions by id and node type", () => {
    expect(getBlockDefinition("tabs")?.nodeTypes).toContain("tabBlock");
    expect(getBlockDefinitionForNodeType("databaseBlock")?.id).toBe("database");
    expect(getBlockDefinitionForNodeType("tableCell")?.id).toBe("table");
    expect(getBlockDefinitionForNodeType("toggleHeader")?.id).toBe("toggle");
    expect(getBlockDefinitionForNodeType("pageLink")?.id).toBe("pageMention");
  });

  it("keeps declared slash titles connected to actual slash menu entries", () => {
    const entries = getSlashMenuEntries();
    const rootTitles = new Set(entries.map((entry) => entry.title));
    const leafTitles = new Set(flattenSlashEntries(entries).map((entry) => entry.title));

    for (const definition of blockDefinitions) {
      for (const slashTitle of definition.slashTitles) {
        expect(rootTitles.has(slashTitle) || leafTitles.has(slashTitle)).toBe(true);
      }
    }
  });

  it("declares extension policies for future block migrations and UI", () => {
    for (const definition of blockDefinitions) {
      expect(definition.serialization.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(definition.serialization.stableType).toBe(definition.id);
      expect(definition.command.slashTitles).toEqual(definition.slashTitles);
      expect(definition.toolbar.kind).toMatch(
        /^(none|text|media|database|container)$/,
      );
    }
  });
});
