import { getBlockDefinitionForNodeType } from "./registry";

const HANDLE_SUPPRESSED_NODE_TYPES = new Set([
  "columnLayout",
  "column",
  "toggleHeader",
  "toggleContent",
  // list 컨테이너는 핸들 표시 안 함 — 개별 listItem/taskItem 이 담당
  // gap 에서 posAtCoords 가 컨테이너 위치를 반환해도 handle 이 뜨지 않도록 억제
  "bulletList",
  "orderedList",
  "taskList",
]);

const FLATTENABLE_WRAPPER_NODE_TYPES = new Set([
  "callout",
  "toggle",
  "blockquote",
]);

export function shouldSuppressBlockHandle(nodeType: string): boolean {
  return (
    HANDLE_SUPPRESSED_NODE_TYPES.has(nodeType) ||
    getBlockDefinitionForNodeType(nodeType)?.editor.suppressBlockHandle === true
  );
}

export function shouldFlattenWrapperBeforeTypeChange(nodeType: string): boolean {
  return (
    FLATTENABLE_WRAPPER_NODE_TYPES.has(nodeType) ||
    getBlockDefinitionForNodeType(nodeType)?.editor.flattenBeforeTypeChange === true
  );
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
