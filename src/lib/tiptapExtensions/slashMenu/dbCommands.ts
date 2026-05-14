import type { Editor, Range } from "@tiptap/react";
import {
  IndentIncrease,
  Link,
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

/** DB 전체 페이지 생성 + 버튼 삽입 공통 로직 */
function createFullPageDatabase(
  editor: Editor,
  range: Range,
  view: ViewKind,
  navigate: boolean,
): void {
  const seedTitle = "새 데이터베이스";
  scheduleSlashMutation(range, (stableRange) => {
    const dbStore = useDatabaseStore.getState();
    const dbId = dbStore.createDatabase(seedTitle);
    const actualTitle = dbStore.databases[dbId]?.meta.title ?? seedTitle;
    const store = usePageStore.getState();
    // DB 전용 홈 페이지는 생성하되 사이드바 카테고리에는 노출하지 않는다.
    const homePageId = store.createPage(actualTitle, null, { activate: false });
    store.updateDoc(homePageId, {
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
          href: buildQuickNotePageUrl({ pageId: homePageId }),
          databaseId: dbId,
        },
      })
      .insertContent(" ")
      .run();
    if (navigate) {
      store.setActivePage(homePageId);
    }
  });
}

/** "DB - 전체 페이지": 생성 즉시 DB 페이지로 이동 */
export function insertFullPageDatabase(
  editor: Editor,
  range: Range,
  view: ViewKind,
): void {
  createFullPageDatabase(editor, range, view, true);
}

/** "DB - 버튼": DB 전체 페이지를 생성하고 버튼만 삽입, 현재 페이지 유지 */
export function insertDatabaseButton(
  editor: Editor,
  range: Range,
  view: ViewKind,
): void {
  createFullPageDatabase(editor, range, view, false);
}

export const dbSlashChildren: SlashLeafItem[] = [
  slashLeaf({
    id: "dbFullPage",
    title: "DB - 전체 페이지",
    description: "DB 페이지 생성 후 즉시 이동",
    icon: PanelTop,
    keywords: ["db", "database", "full", "page", "전체", "페이지", "데이터", "데이터베이스"],
    command: ({ editor, range }) =>
      insertFullPageDatabase(editor, range, "table"),
  }),
  slashLeaf({
    id: "dbButton",
    title: "DB - 버튼",
    description: "DB 페이지 생성 후 현재 페이지에 버튼 삽입",
    icon: Link,
    keywords: ["db", "database", "button", "버튼", "데이터", "데이터베이스"],
    command: ({ editor, range }) =>
      insertDatabaseButton(editor, range, "table"),
  }),
  slashLeaf({
    id: "dbInline",
    title: "DB - 인라인",
    description: "현재 페이지에 블록 삽입",
    icon: IndentIncrease,
    keywords: ["db", "database", "inline", "인라인", "데이터", "데이터베이스"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "table",
      }),
  }),
];
