import type { JSONContent } from "@tiptap/react";

export type Page = {
  id: string;
  title: string;
  icon: string | null;
  doc: JSONContent;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
};

export type PageMap = Record<string, Page>;
