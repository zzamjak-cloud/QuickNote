import type { Editor, Range } from "@tiptap/react";
import {
  IndentIncrease,
  PanelTop,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { emptyPanelState } from "../../../types/database";
import type { DatabaseLayout, ViewKind } from "../../../types/database";
import { scheduleSlashMutation } from "./commandHelpers";
import { slashLeaf } from "./entryBuilders";
import type { SlashLeafItem } from "./types";
import { buildQuickNotePageUrl } from "../../navigation/quicknoteLinks";

export function insertDatabaseBlock(
  editor: Editor,
  range: Range,
  opts: { layout: DatabaseLayout; view: ViewKind },
): void {
  scheduleSlashMutation(range, (stableRange) => {
    editor
      .chain()
      .focus()
      .deleteRange(stableRange)
      .insertContent({
        type: "databaseBlock",
        attrs: {
          databaseId: "",
          layout: opts.layout,
          view: opts.view,
          panelState: JSON.stringify(emptyPanelState()),
        },
      })
      .run();
  });
}

export function insertFullPageDatabase(
  editor: Editor,
  range: Range,
  view: ViewKind,
): void {
  const seedTitle = "새 데이터베이스";
  scheduleSlashMutation(range, (stableRange) => {
    const dbStore = useDatabaseStore.getState();
    const dbId = dbStore.createDatabase(seedTitle);
    const actualTitle = dbStore.databases[dbId]?.meta.title ?? seedTitle;
    const store = usePageStore.getState();
    // DB 전용 홈 페이지는 생성하되 사이드바 카테고리에는 노출하지 않는다.
    const pageId = store.createPage(actualTitle, null, { activate: false });
    store.updateDoc(pageId, {
      type: "doc",
      content: [
        {
          type: "databaseBlock",
          attrs: {
            databaseId: dbId,
            layout: "fullPage",
            view,
            panelState: JSON.stringify(emptyPanelState()),
          },
        },
      ],
    });
    editor
      .chain()
      .focus()
      .deleteRange(stableRange)
      .insertContent({
        type: "buttonBlock",
        attrs: {
          label: `${actualTitle} DB`,
          href: buildQuickNotePageUrl({ pageId }),
        },
      })
      .insertContent(" ")
      .run();
    // 현재 문맥은 유지하고 @멘션만 남긴다.
  });
}

export const dbSlashChildren: SlashLeafItem[] = [
  slashLeaf({
    title: "DB - 전체 페이지",
    description: "새 페이지에 데이터베이스만 표시",
    icon: PanelTop,
    keywords: ["db", "database", "full", "page", "전체", "페이지"],
    command: ({ editor, range }) =>
      insertFullPageDatabase(editor, range, "table"),
  }),
  slashLeaf({
    title: "DB - 인라인",
    description: "현재 페이지에 블록 삽입",
    icon: IndentIncrease,
    keywords: ["db", "database", "inline", "인라인"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "table",
      }),
  }),
];
