import type { SlashCategoryItem, SlashLeafItem } from "./types";

export function slashLeaf(input: Omit<SlashLeafItem, "kind">): SlashLeafItem {
  return { kind: "leaf", ...input };
}

export function slashCategory(
  input: Omit<SlashCategoryItem, "kind">,
): SlashCategoryItem {
  return { kind: "category", ...input };
}
