import type { Editor, Range } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";

export type SlashCommandContext = {
  editor: Editor;
  range: Range;
};

export type SlashLeafItem = {
  kind: "leaf";
  /** 컨텍스트 필터링용 식별자 */
  id?: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  command: (ctx: SlashCommandContext) => void;
};

export type SlashCategoryItem = {
  kind: "category";
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  children: SlashLeafItem[];
};

export type SlashMenuEntry = SlashLeafItem | SlashCategoryItem;

/** @deprecated SlashLeafItem 사용 */
export type SlashItem = SlashLeafItem;
