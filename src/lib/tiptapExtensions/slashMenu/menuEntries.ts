import {
  AtSign,
  CheckSquare,
  ChevronRight,
  Code2,
  Database as DatabaseIcon,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Smile,
  Table as TableIcon,
  Youtube as YoutubeIcon,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { isTrustedYoutubeInput } from "../../safeUrl";
import { dbSlashChildren } from "./dbCommands";
import type { SlashMenuEntry } from "./types";

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
      void (async () => {
        const url = await useUiStore.getState().requestTextPrompt(
          "YouTube URL을 입력하세요",
          { placeholder: "https://www.youtube.com/watch?v=…" },
        );
        editor.chain().focus().deleteRange(range).run();
        const trimmed = url?.trim() ?? "";
        if (trimmed && isTrustedYoutubeInput(trimmed)) {
          editor.chain().focus().setYoutubeVideo({ src: trimmed }).run();
        }
      })();
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
