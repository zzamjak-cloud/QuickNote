import { getSlashMenuEntries } from "../../blocks/registry";
import type {
  SlashCategoryItem,
  SlashLeafItem,
  SlashMenuEntry,
} from "./types";

/** 루트 목록만 필터 (서브메뉴는 SlashMenu 내부에서 처리) */
export function filterSlashMenuEntries(query: string): SlashMenuEntry[] {
  const slashMenuEntries = getSlashMenuEntries();
  const q = query.trim().toLowerCase();
  if (!q) return slashMenuEntries;

  function leafMatch(item: SlashLeafItem): boolean {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  }

  function categoryMatch(cat: SlashCategoryItem): boolean {
    if (cat.title.toLowerCase().includes(q)) return true;
    if (cat.description.toLowerCase().includes(q)) return true;
    if (cat.keywords.some((k) => k.toLowerCase().includes(q))) return true;
    return cat.children.some((c) => leafMatch(c));
  }

  return slashMenuEntries.filter((e) => {
    if (e.kind === "leaf") return leafMatch(e);
    return categoryMatch(e);
  });
}

export function filterSlashLeaves(
  leaves: SlashLeafItem[],
  query: string,
): SlashLeafItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return leaves;
  return leaves.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

/** @deprecated filterSlashMenuEntries 사용 */
export function filterSlashItems(query: string): SlashLeafItem[] {
  const filtered = filterSlashMenuEntries(query);
  const out: SlashLeafItem[] = [];
  for (const e of filtered) {
    if (e.kind === "leaf") out.push(e);
    else out.push(...e.children);
  }
  return out;
}
