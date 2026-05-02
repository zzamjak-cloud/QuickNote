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
  type LucideIcon,
} from "lucide-react";

export type SlashCommandContext = {
  editor: Editor;
  range: Range;
};

export type SlashItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  command: (ctx: SlashCommandContext) => void;
};

export const slashItems: SlashItem[] = [
  {
    title: "본문",
    description: "일반 텍스트 단락",
    icon: Pilcrow,
    keywords: ["paragraph", "text", "본문", "단락"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "제목 1",
    description: "큰 섹션 제목",
    icon: Heading1,
    keywords: ["heading1", "h1", "제목", "title"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "제목 2",
    description: "중간 섹션 제목",
    icon: Heading2,
    keywords: ["heading2", "h2", "subheading"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "제목 3",
    description: "작은 섹션 제목",
    icon: Heading3,
    keywords: ["heading3", "h3"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: "글머리 기호 목록",
    description: "• 단순 목록",
    icon: List,
    keywords: ["bullet", "list", "ul", "글머리"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "번호 목록",
    description: "1. 순서 있는 목록",
    icon: ListOrdered,
    keywords: ["ordered", "numbered", "list", "ol", "번호"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "할 일",
    description: "체크박스 목록",
    icon: CheckSquare,
    keywords: ["todo", "task", "check", "할 일", "체크"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "코드 블록",
    description: "구문 강조 코드",
    icon: Code2,
    keywords: ["code", "코드", "snippet"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "인용",
    description: "강조 인용 단락",
    icon: Quote,
    keywords: ["quote", "blockquote", "인용"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "구분선",
    description: "수평선 추가",
    icon: Minus,
    keywords: ["divider", "hr", "horizontal", "구분"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "이미지",
    description: "이미지 업로드",
    icon: ImageIcon,
    keywords: ["image", "이미지", "사진"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      window.dispatchEvent(new CustomEvent("quicknote:open-image-upload"));
    },
  },
  {
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
    title: "콜아웃",
    description: "💡 강조 박스",
    icon: Lightbulb,
    keywords: ["callout", "info", "tip", "강조", "콜아웃"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCallout("💡").run(),
  },
  {
    title: "토글",
    description: "접고 펼 수 있는 블록",
    icon: ChevronRight,
    keywords: ["toggle", "details", "collapse", "토글", "접기"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setToggle().run(),
  },
  {
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
    title: "페이지 링크",
    description: "다른 페이지 멘션 (@)",
    icon: AtSign,
    keywords: ["mention", "page", "link", "멘션", "페이지"],
    command: ({ editor, range }) => {
      // 슬래시는 지우고 '@'를 입력해 멘션 suggestion을 트리거
      editor.chain().focus().deleteRange(range).insertContent("@").run();
    },
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return slashItems;
  return slashItems.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  });
}
