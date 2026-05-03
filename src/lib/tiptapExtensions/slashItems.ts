import type { Editor, Range } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  Quote,
  Minus,
  Image as ImageIcon,
  Pilcrow,
  Table as TableIcon,
  Lightbulb,
  ChevronRight,
  Youtube as YoutubeIcon,
  AtSign,
  FileText,
  LayoutGrid,
  Smile,
  Database as DatabaseIcon,
  PanelTop,
  IndentIncrease,
  Table2,
  Kanban,
  GalleryHorizontal,
  GanttChartSquare,
  type LucideIcon,
} from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { emptyPanelState } from "../../types/database";
import type { DatabaseLayout, ViewKind } from "../../types/database";

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

/**
 * 슬래시 제안은 TipTap ReactRenderer가 flushSync 로 마운트된다.
 * 같은 동기 구간에서 insertContent 를 실행하면 React 19 와 충돌하므로
 * 슬래시 UI 가 정리된 뒤에 에디터 트랜잭션을 실행한다.
 */
function scheduleEditorWork(fn: () => void): void {
  queueMicrotask(fn);
}

function insertDatabaseBlock(
  editor: Editor,
  range: Range,
  opts: { layout: DatabaseLayout; view: ViewKind },
): void {
  const dbId = useDatabaseStore.getState().createDatabase();
  const from = range.from;
  const to = range.to;
  scheduleEditorWork(() => {
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent({
        type: "databaseBlock",
        attrs: {
          databaseId: dbId,
          layout: opts.layout,
          view: opts.view,
          panelState: JSON.stringify(emptyPanelState()),
        },
      })
      .run();
  });
}

function insertFullPageDatabase(
  editor: Editor,
  range: Range,
  view: ViewKind,
): void {
  const title = "새 데이터베이스";
  const dbId = useDatabaseStore.getState().createDatabase(title);
  const parentId = usePageStore.getState().activePageId;
  const from = range.from;
  const to = range.to;
  scheduleEditorWork(() => {
    const store = usePageStore.getState();
    const pageId = store.createPage(title, parentId, { activate: false });
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
        attrs: { id: pageId, label: title },
      })
      .insertContent(" ")
      .run();
    if (parentId) {
      useSettingsStore.getState().setExpanded(parentId, true);
    }
    store.setActivePage(pageId);
  });
}

const dbSlashChildren: SlashLeafItem[] = [
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

export const slashMenuEntries: SlashMenuEntry[] = [
  {
    kind: "category",
    title: "DB",
    description: "데이터베이스 삽입",
    icon: DatabaseIcon,
    keywords: [
      "db",
      "database",
      "데이터",
      "데이터베이스",
      "노션",
      "전체 페이지",
      "인라인",
      "칸반",
      "갤러리",
      "타임라인",
    ],
    children: dbSlashChildren,
  },
  {
    kind: "leaf",
    title: "본문",
    description: "일반 텍스트 단락",
    icon: Pilcrow,
    keywords: ["paragraph", "text", "본문", "단락"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    kind: "leaf",
    title: "제목 1",
    description: "큰 섹션 제목",
    icon: Heading1,
    keywords: ["heading1", "h1", "제목", "title"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    kind: "leaf",
    title: "제목 2",
    description: "중간 섹션 제목",
    icon: Heading2,
    keywords: ["heading2", "h2", "subheading"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    kind: "leaf",
    title: "제목 3",
    description: "작은 섹션 제목",
    icon: Heading3,
    keywords: ["heading3", "h3"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    kind: "leaf",
    title: "글머리 기호 목록",
    description: "• 단순 목록",
    icon: List,
    keywords: ["bullet", "list", "ul", "글머리"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    kind: "leaf",
    title: "번호 목록",
    description: "1. 순서 있는 목록",
    icon: ListOrdered,
    keywords: ["ordered", "numbered", "list", "ol", "번호"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    kind: "leaf",
    title: "할 일",
    description: "체크박스 목록",
    icon: CheckSquare,
    keywords: ["todo", "task", "check", "할 일", "체크"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    kind: "leaf",
    title: "코드 블록",
    description: "구문 강조 코드",
    icon: Code2,
    keywords: ["code", "코드", "snippet"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    kind: "leaf",
    title: "인용",
    description: "강조 인용 단락",
    icon: Quote,
    keywords: ["quote", "blockquote", "인용"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    kind: "leaf",
    title: "구분선",
    description: "수평선 추가",
    icon: Minus,
    keywords: ["divider", "hr", "horizontal", "구분"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    kind: "leaf",
    title: "이미지",
    description: "이미지 업로드",
    icon: ImageIcon,
    keywords: ["image", "이미지", "사진"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("quicknote:open-image-upload"));
      }, 0);
    },
  },
  {
    kind: "leaf",
    title: "이모지",
    description: "이모지 아이콘 삽입",
    icon: Smile,
    keywords: ["emoji", "이모지", "아이콘", "icon", "emoticon"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("quicknote:open-emoji-picker"));
      }, 0);
    },
  },
  {
    kind: "leaf",
    title: "새 페이지",
    description: "현재 페이지의 하위 페이지를 추가하고 멘션 삽입",
    icon: FileText,
    keywords: ["page", "subpage", "new", "페이지", "하위"],
    command: ({ editor, range }) => {
      const store = usePageStore.getState();
      const parentId = store.activePageId;
      const newId = store.createPage("새 페이지", parentId);
      if (parentId) {
        store.setActivePage(parentId);
      }
      setTimeout(() => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "mention",
            attrs: { id: newId, label: "새 페이지" },
          })
          .insertContent(" ")
          .run();
        usePageStore.getState().setActivePage(newId);
      }, 0);
    },
  },
  {
    kind: "leaf",
    title: "표",
    description: "3 × 3 표 삽입",
    icon: TableIcon,
    keywords: ["table", "grid", "표", "테이블"],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    kind: "leaf",
    title: "콜아웃",
    description: "💡 강조 박스",
    icon: Lightbulb,
    keywords: ["callout", "info", "tip", "강조", "콜아웃"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCallout("idea").run(),
  },
  {
    kind: "leaf",
    title: "토글",
    description: "접고 펼 수 있는 블록",
    icon: ChevronRight,
    keywords: ["toggle", "details", "collapse", "토글", "접기"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setToggle().run(),
  },
  {
    kind: "leaf",
    title: "제목 토글 목록 1",
    description: "큰 제목 스타일 토글",
    icon: Heading1,
    keywords: ["toggle h1", "토글 제목1", "heading toggle 1"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeadingToggle(1).run(),
  },
  {
    kind: "leaf",
    title: "제목 토글 목록 2",
    description: "중간 제목 스타일 토글",
    icon: Heading2,
    keywords: ["toggle h2", "토글 제목2", "heading toggle 2"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeadingToggle(2).run(),
  },
  {
    kind: "leaf",
    title: "제목 토글 목록 3",
    description: "작은 제목 스타일 토글",
    icon: Heading3,
    keywords: ["toggle h3", "토글 제목3", "heading toggle 3"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeadingToggle(3).run(),
  },
  {
    kind: "leaf",
    title: "2개의 열",
    description: "나란히 두 열 레이아웃",
    icon: LayoutGrid,
    keywords: ["columns", "2 col", "두 열", "2열", "column"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setColumnLayout(2).run(),
  },
  {
    kind: "leaf",
    title: "3개의 열",
    description: "세 열 레이아웃",
    icon: LayoutGrid,
    keywords: ["3 col", "세 열", "3열"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setColumnLayout(3).run(),
  },
  {
    kind: "leaf",
    title: "4개의 열",
    description: "네 열 레이아웃",
    icon: LayoutGrid,
    keywords: ["4 col", "네 열", "4열"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setColumnLayout(4).run(),
  },
  {
    kind: "leaf",
    title: "유튜브 임베드",
    description: "YouTube URL 삽입",
    icon: YoutubeIcon,
    keywords: ["youtube", "video", "embed", "유튜브", "임베드"],
    command: ({ editor, range }) => {
      const url = prompt("YouTube URL을 입력하세요:");
      editor.chain().focus().deleteRange(range).run();
      if (url && url.trim()) {
        editor.chain().focus().setYoutubeVideo({ src: url.trim() }).run();
      }
    },
  },
  {
    kind: "leaf",
    title: "페이지 링크",
    description: "다른 페이지 멘션 (@)",
    icon: AtSign,
    keywords: ["mention", "page", "link", "멘션", "페이지"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      setTimeout(() => {
        const { from } = editor.state.selection;
        editor.view.dispatch(editor.state.tr.insertText("@", from));
      }, 0);
    },
  },
];

/** 루트 목록만 필터 (서브메뉴는 SlashMenu 내부에서 처리) */
export function filterSlashMenuEntries(query: string): SlashMenuEntry[] {
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
