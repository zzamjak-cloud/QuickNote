import type { JSONContent } from "@tiptap/react";
import { blockDefinitions, getBlockDefinitionForNodeType } from "./registry";

const UNIQUE_ID_EXCLUDED_NODE_TYPES = new Set([
  "emoji",
  "fileBlock",
  "image",
  "lucideInlineIcon",
  "mention",
  "youtube",
]);

export const EDITOR_UNIQUE_ID_TYPES = blockDefinitions
  .flatMap((definition) => definition.nodeTypes)
  .filter((nodeType) => {
    const definition = getBlockDefinitionForNodeType(nodeType);
    return (
      !UNIQUE_ID_EXCLUDED_NODE_TYPES.has(nodeType) &&
      definition?.editor.excludeFromUniqueId !== true
    );
  });

export function isDatabaseBlockType(nodeType: string | null | undefined): boolean {
  return (
    typeof nodeType === "string" &&
    getBlockDefinitionForNodeType(nodeType)?.id === "database"
  );
}

export function getFirstDatabaseBlockId(doc: JSONContent): string | null {
  const first = doc.content?.[0];
  if (!isDatabaseBlockType(first?.type)) return null;
  const databaseId = first?.attrs?.databaseId;
  return typeof databaseId === "string" && databaseId ? databaseId : null;
}

export function isFullPageDatabaseDoc(doc: JSONContent | null | undefined): boolean {
  const first = doc?.content?.[0];
  return (
    isDatabaseBlockType(first?.type) &&
    (first?.attrs as { layout?: string } | undefined)?.layout === "fullPage"
  );
}

export function normalizeFullPageDatabaseDoc(doc: JSONContent): JSONContent {
  if (!isFullPageDatabaseDoc(doc)) return doc;
  const first = doc.content?.[0];
  if (!first || doc.content?.length === 1) return doc;
  return {
    type: "doc",
    content: [structuredClone(first) as JSONContent],
  };
}
