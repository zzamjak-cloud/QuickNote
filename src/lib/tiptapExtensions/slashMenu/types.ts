import type { Editor, Range } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";

export type SlashCommandContext = {
  editor: Editor;
  range: Range;
};

export type SlashLeafItem = {
  kind: "leaf";
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
