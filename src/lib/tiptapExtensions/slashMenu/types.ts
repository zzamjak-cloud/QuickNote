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
  /** false 반환 시 메뉴에서 숨김 — 기능 게이팅용(예: AI 비활성 워크스페이스) */
  available?: (editor?: Editor) => boolean;
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
