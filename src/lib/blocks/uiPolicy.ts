import { getBlockDefinitionForNodeType } from "./registry";

const HANDLE_SUPPRESSED_NODE_TYPES = new Set([
  "columnLayout",
  "column",
  "toggleHeader",
  "toggleContent",
]);

const FLATTENABLE_WRAPPER_NODE_TYPES = new Set([
  "callout",
  "toggle",
  "blockquote",
]);

export function shouldSuppressBlockHandle(nodeType: string): boolean {
  return HANDLE_SUPPRESSED_NODE_TYPES.has(nodeType);
}

export function shouldFlattenWrapperBeforeTypeChange(nodeType: string): boolean {
  return FLATTENABLE_WRAPPER_NODE_TYPES.has(nodeType);
}

export function shouldUseDatabaseBlockChrome(nodeType: string): boolean {
  return getBlockDefinitionForNodeType(nodeType)?.id === "database";
}

export function isAttachmentBlockNodeType(nodeType: string): boolean {
  return getBlockDefinitionForNodeType(nodeType)?.id === "file";
}

export function isCalloutBlockNodeType(nodeType: string): boolean {
  return getBlockDefinitionForNodeType(nodeType)?.id === "callout";
}
