import type { Editor, Range } from "@tiptap/react";
import {
  GanttChartSquare,
  GalleryHorizontal,
  IndentIncrease,
  Kanban,
  PanelTop,
  Table2,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { emptyPanelState } from "../../../types/database";
import type { DatabaseLayout, ViewKind } from "../../../types/database";
import { scheduleEditorMutation } from "../../pm/scheduleEditorMutation";
import type { SlashLeafItem } from "./types";

export function insertDatabaseBlock(
  editor: Editor,
  range: Range,
  opts: { layout: DatabaseLayout; view: ViewKind },
): void {
  const from = range.from;
  const to = range.to;
  scheduleEditorMutation(() => {
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
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
  const from = range.from;
  const to = range.to;
  scheduleEditorMutation(() => {
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
      .deleteRange({ from, to })
      .insertContent({
        type: "mention",
        attrs: { id: pageId, label: actualTitle },
      })
      .insertContent(" ")
      .run();
    // 현재 문맥은 유지하고 @멘션만 남긴다.
  });
}

export const dbSlashChildren: SlashLeafItem[] = [
  {
    kind: "leaf",
    title: "전체 페이지",
    description: "새 페이지에 데이터베이스만 표시",
    icon: PanelTop,
    keywords: ["full", "page", "전체", "페이지"],
    command: ({ editor, range }) =>
      insertFullPageDatabase(editor, range, "table"),
  },
  {
    kind: "leaf",
    title: "인라인",
    description: "현재 페이지에 블록 삽입",
    icon: IndentIncrease,
    keywords: ["inline", "인라인"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "table",
      }),
  },
  {
    kind: "leaf",
    title: "표",
    description: "표 보기 데이터베이스",
    icon: Table2,
    keywords: ["table", "표", "테이블"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "table",
      }),
  },
  {
    kind: "leaf",
    title: "칸반 보드",
    description: "보드 보기",
    icon: Kanban,
    keywords: ["kanban", "board", "칸반"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "kanban",
      }),
  },
  {
    kind: "leaf",
    title: "갤러리",
    description: "갤러리 카드 보기",
    icon: GalleryHorizontal,
    keywords: ["gallery", "갤러리"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "gallery",
      }),
  },
  {
    kind: "leaf",
    title: "타임라인",
    description: "타임라인 보기",
    icon: GanttChartSquare,
    keywords: ["timeline", "time", "타임라인"],
    command: ({ editor, range }) =>
      insertDatabaseBlock(editor, range, {
        layout: "inline",
        view: "timeline",
      }),
  },
];
