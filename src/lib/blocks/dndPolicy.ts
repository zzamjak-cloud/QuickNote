import { getBlockDefinitionForNodeType } from "./registry";

export type DropContainerType =
  | "doc"
  | "column"
  | "tabPanel"
  | "toggleContent"
  | "callout";

export function canDropNodeTypeInContainers(
  nodeType: string,
  containers: readonly DropContainerType[],
): boolean {
  if (containers.includes("doc") && containers.length === 1) return true;
  const definition = getBlockDefinitionForNodeType(nodeType);
  if (!definition) return true;
  if (containers.includes("column") && !definition.dnd.allowInsideColumns) {
    return false;
  }
  if (containers.includes("tabPanel") && !definition.dnd.allowInsideTabs) {
    return false;
  }
  // toggleContent는 별도 제약 없이 block schema 허용 범위에 위임한다.
  return true;
}
