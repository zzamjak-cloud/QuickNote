import type { Editor, Range } from "@tiptap/react";
import {
  IndentIncrease,
  PanelTop,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useNavigationHistoryStore } from "../../../store/navigationHistoryStore";
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

/** "DB - 전체 페이지": DB·전용 홈 페이지 생성 후 현재 페이지에는 자동으로 DB 전용 버튼을 삽입하고, DB 페이지로 이동한다. */
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
          // DB 전용 버튼: label 은 buttonBlock 의 DB 모드에서 store 제목을 따라 자동 동기화된다.
          label: `${actualTitle} DB`,
          href: buildQuickNotePageUrl({ pageId: homePageId }),
          databaseId: dbId,
        },
      })
      .insertContent(" ")
      .run();
    // setActivePage 가 호출되면 에디터가 곧바로 다른 페이지로 unmount 되어
    // autosave 디바운스(700ms) 가 취소되고 방금 삽입한 DB 버튼이 소실된다.
    // 즉시 호스트 페이지 doc 을 store 에 반영해 영구화한다.
    const hostPageId =
      (editor.storage.pageContext as { pageId?: string | null } | undefined)?.pageId ?? null;
    if (hostPageId) {
      store.updateDoc(hostPageId, editor.getJSON());
      // DB 페이지에서 "< 이전 페이지" 로 돌아갈 수 있도록 호스트 페이지를 히스토리에 push.
      useNavigationHistoryStore.getState().pushBack(hostPageId);
    }
    store.setActivePage(homePageId);
  });
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
