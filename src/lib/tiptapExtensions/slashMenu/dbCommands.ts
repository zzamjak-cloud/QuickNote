import type { Editor, Range } from "@tiptap/react";
import {
  IndentIncrease,
  PanelTop,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useDatabaseViewPrefsStore } from "../../../store/databaseViewPrefsStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useNavigationHistoryStore } from "../../../store/navigationHistoryStore";
import { emptyPanelState } from "../../../types/database";
import type { DatabaseLayout, ViewKind } from "../../../types/database";
import { scheduleSlashMutation } from "./commandHelpers";
import { slashLeaf } from "./entryBuilders";
import type { SlashLeafItem } from "./types";

export function insertDatabaseBlock(
  editor: Editor,
  range: Range,
  opts: { layout: DatabaseLayout; view: ViewKind },
): void {
  scheduleSlashMutation(range, (stableRange) => {
    const chain = editor
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
      });
    if (opts.layout === "inline") {
      chain.command(({ tr }) => {
        tr.setMeta("addToHistory", false);
        return true;
      });
    }
    chain.run();
  });
}

/** "DB - 전체 페이지": DB와 숨김 fullPage 홈 문서를 만들고 DB 탭으로 연다. */
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

    useDatabaseViewPrefsStore.getState().setView(dbId, view);
    store.ensureFullPagePageForDatabase(dbId, actualTitle, view);

    editor
      .chain()
      .focus()
      .deleteRange(stableRange)
      .insertContent({
        type: "buttonBlock",
        attrs: {
          // DB 전용 버튼: label 은 buttonBlock 의 DB 모드에서 store 제목을 따라 자동 동기화된다.
          label: `${actualTitle} DB`,
          href: "",
          databaseId: dbId,
        },
      })
      .insertContent(" ")
      .run();

    // DB 탭으로 전환되기 전에 호스트 페이지 doc 을 즉시 저장해 방금 삽입한 버튼을 보존한다.
    const hostPageId =
      (editor.storage.pageContext as { pageId?: string | null } | undefined)?.pageId ?? null;
    if (hostPageId) {
      store.updateDoc(hostPageId, editor.getJSON());
      useNavigationHistoryStore.getState().pushBack(hostPageId);
    }

    store.setActivePage(null);
    useSettingsStore.getState().setCurrentTabDatabase(dbId);
  });
}

export const dbSlashChildren: SlashLeafItem[] = [
  slashLeaf({
    id: "dbFullPage",
    title: "DB - 전체 페이지",
    description: "DB 생성 후 DB 탭으로 직접 이동",
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
