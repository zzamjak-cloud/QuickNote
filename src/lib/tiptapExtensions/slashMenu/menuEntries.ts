import {
  AtSign,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  LayoutGrid,
  PanelTop,
  Lightbulb,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Smile,
  Link,
  Table as TableIcon,
  Youtube as YoutubeIcon,
} from "lucide-react";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { isTrustedYoutubeInput } from "../../safeUrl";
import { clearSlashRange, runSlashCommand } from "./commandHelpers";
import { dbSlashChildren } from "./dbCommands";
import { slashLeaf } from "./entryBuilders";
import type { SlashCommandContext, SlashMenuEntry } from "./types";

function countProtectedMediaBlocks(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const n = node as {
    type?: string;
    attrs?: { mime?: string; mimeType?: string; contentType?: string };
    content?: unknown[];
  };
  const isYoutube = n.type === "youtube";
  const mime =
    typeof n.attrs?.mime === "string"
      ? n.attrs.mime
      : typeof n.attrs?.mimeType === "string"
        ? n.attrs.mimeType
        : typeof n.attrs?.contentType === "string"
          ? n.attrs.contentType
          : null;
  const isVideoFile =
    n.type === "fileBlock" &&
    typeof mime === "string" &&
    mime.startsWith("video/");
  const self = isYoutube || isVideoFile ? 1 : 0;
  if (!Array.isArray(n.content) || n.content.length === 0) return self;
  return (
    self +
    n.content.reduce<number>(
      (acc, child) => acc + countProtectedMediaBlocks(child),
      0,
    )
  );
}

function runColumnLayoutCommand(editor: SlashCommandContext["editor"]) {
  const before = editor.getJSON();
  const beforeMediaCount = countProtectedMediaBlocks(before);
  const chain = editor.chain().focus();
  const { $from } = editor.state.selection;
  // slash 범위(range)는 신뢰하지 않고 현재 단락 내부 텍스트만 정리한다.
  // 이렇게 하면 다른 블록(특히 미디어 블록)까지 함께 삭제되는 경로를 차단할 수 있다.
  if ($from.parent.type.name === "paragraph") {
    const from = $from.start();
    const to = from + $from.parent.content.size;
    if (from < to) {
      chain.deleteRange({ from, to });
    }
  }
  const ok = chain.setColumnLayout(2).run();
  if (!ok) return false;
  const after = editor.getJSON();
  const afterMediaCount = countProtectedMediaBlocks(after);
  if (afterMediaCount < beforeMediaCount) {
    editor.commands.setContent(before, { emitUpdate: true });
    return false;
  }
  return true;
}

function runTabBlockCommand(
  editor: SlashCommandContext["editor"],
  placement: "top" | "bottom" | "left" | "right",
) {
  const chain = editor.chain().focus();
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === "paragraph") {
    const from = $from.start();
    const to = from + $from.parent.content.size;
    if (from < to) chain.deleteRange({ from, to });
  }
  return chain.setTabBlock(placement).run();
}

export const slashMenuEntries: SlashMenuEntry[] = [
  slashLeaf({
    id: "tabBlock",
    title: "탭",
    description: "탭으로 구분된 컨텐츠 블록",
    icon: PanelTop,
    keywords: ["tabs", "tab", "탭", "tab block"],
    command: ({ editor }) => runTabBlockCommand(editor, "top"),
  }),
  slashLeaf({
    title: "본문",
    description: "일반 텍스트 단락",
    icon: Pilcrow,
    keywords: ["paragraph", "text", "본문", "단락"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setParagraph()),
  }),
  slashLeaf({
    title: "제목 1",
    description: "큰 섹션 제목",
    icon: Heading1,
    keywords: ["heading1", "h1", "제목", "title"],
    command: (ctx) =>
      runSlashCommand(ctx, (chain) => chain.setHeading({ level: 1 })),
  }),
  slashLeaf({
    title: "제목 2",
    description: "중간 섹션 제목",
    icon: Heading2,
    keywords: ["heading2", "h2", "subheading"],
    command: (ctx) =>
      runSlashCommand(ctx, (chain) => chain.setHeading({ level: 2 })),
  }),
  slashLeaf({
    title: "제목 3",
    description: "작은 섹션 제목",
    icon: Heading3,
    keywords: ["heading3", "h3"],
    command: (ctx) =>
      runSlashCommand(ctx, (chain) => chain.setHeading({ level: 3 })),
  }),
  slashLeaf({
    title: "글머리 기호 목록",
    description: "• 단순 목록",
    icon: List,
    keywords: ["bullet", "list", "ul", "글머리"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.toggleBulletList()),
  }),
  slashLeaf({
    title: "번호 목록",
    description: "1. 순서 있는 목록",
    icon: ListOrdered,
    keywords: ["ordered", "numbered", "list", "ol", "번호"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.toggleOrderedList()),
  }),
  slashLeaf({
    title: "할 일",
    description: "체크박스 목록",
    icon: CheckSquare,
    keywords: ["todo", "task", "check", "할 일", "체크"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.toggleTaskList()),
  }),
  slashLeaf({
    title: "코드 블록",
    description: "구문 강조 코드",
    icon: Code2,
    keywords: ["code", "코드", "snippet"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.toggleCodeBlock()),
  }),
  slashLeaf({
    title: "인용",
    description: "강조 인용 단락",
    icon: Quote,
    keywords: ["quote", "blockquote", "인용"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.toggleBlockquote()),
  }),
  slashLeaf({
    title: "구분선",
    description: "수평선 추가",
    icon: Minus,
    keywords: ["divider", "hr", "horizontal", "구분"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setHorizontalRule()),
  }),
  slashLeaf({
    id: "image",
    title: "이미지",
    description: "이미지 업로드",
    icon: ImageIcon,
    keywords: ["image", "이미지", "사진"],
    command: (ctx) => {
      clearSlashRange(ctx);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("quicknote:open-image-upload"));
      }, 0);
    },
  }),
  slashLeaf({
    title: "이모지",
    description: "이모지 아이콘 삽입",
    icon: Smile,
    keywords: ["emoji", "이모지", "아이콘", "icon", "emoticon"],
    command: (ctx) => {
      clearSlashRange(ctx);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("quicknote:open-emoji-picker"));
      }, 0);
    },
  }),
  slashLeaf({
    title: "날짜",
    description: "클릭해서 바꿀 수 있는 날짜",
    icon: CalendarDays,
    keywords: ["date", "calendar", "날짜", "달력"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.insertDateInline()),
  }),
  slashLeaf({
    title: "새 페이지",
    description: "현재 페이지의 하위 페이지를 추가하고 멘션 삽입",
    icon: FileText,
    keywords: ["page", "subpage", "new", "페이지", "하위"],
    command: ({ editor, range }) => {
      const store = usePageStore.getState();
      // 호스트 페이지 ID 우선순위: editor 의 pageContext → activePageId 폴백.
      // 피크/풀뷰의 DB 항목 페이지를 편집 중일 때도 그 항목을 부모로 잡기 위함.
      const ctx = editor.storage.pageContext as { pageId?: string | null } | undefined;
      const parentId = ctx?.pageId ?? store.activePageId;
      // 자동 활성화는 끈다 — 사용자는 현재 페이지에 머무르고 멘션 버튼만 보게 된다.
      const newId = store.createPage("새 페이지", parentId, { activate: false });
      setTimeout(() => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "mention",
            // 페이지 멘션은 "p:" 프리픽스 + mentionKind: "page" 로 식별 —
            // 이 포맷이어야 MemberMention NodeView 가 페이지 제목을 반응형으로 동기화함
            attrs: {
              id: `p:${newId}`,
              label: "새 페이지",
              mentionKind: "page",
            },
          })
          .insertContent(" ")
          .run();
      }, 0);
    },
  }),
  slashLeaf({
    id: "table",
    title: "표",
    description: "3 × 3 표 삽입",
    icon: TableIcon,
    keywords: ["table", "grid", "표", "테이블"],
    command: (ctx) =>
      runSlashCommand(ctx, (chain) =>
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
      ),
  }),
  slashLeaf({
    title: "버튼",
    description: "링크 버튼 삽입",
    icon: Link,
    keywords: ["button", "link", "버튼", "링크", "url"],
    command: (ctx) =>
      runSlashCommand(ctx, (chain) => chain.insertButtonBlock("버튼", "")),
  }),
  slashLeaf({
    title: "콜아웃",
    description: "💡 강조 박스",
    icon: Lightbulb,
    keywords: ["callout", "info", "tip", "강조", "콜아웃"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setCallout("idea")),
  }),
  slashLeaf({
    title: "토글",
    description: "접고 펼 수 있는 블록",
    icon: ChevronRight,
    keywords: ["toggle", "details", "collapse", "토글", "접기"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setToggle()),
  }),
  slashLeaf({
    title: "제목 토글 목록 1",
    description: "큰 제목 스타일 토글",
    icon: Heading1,
    keywords: ["toggle h1", "토글 제목1", "heading toggle 1"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setHeadingToggle(1)),
  }),
  slashLeaf({
    title: "제목 토글 목록 2",
    description: "중간 제목 스타일 토글",
    icon: Heading2,
    keywords: ["toggle h2", "토글 제목2", "heading toggle 2"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setHeadingToggle(2)),
  }),
  slashLeaf({
    title: "제목 토글 목록 3",
    description: "작은 제목 스타일 토글",
    icon: Heading3,
    keywords: ["toggle h3", "토글 제목3", "heading toggle 3"],
    command: (ctx) => runSlashCommand(ctx, (chain) => chain.setHeadingToggle(3)),
  }),
  slashLeaf({
    id: "columnLayout",
    title: "컬럼",
    description: "나란히 두 열 레이아웃",
    icon: LayoutGrid,
    keywords: [
      "columns",
      "column",
      "컬럼",
      "열",
      "레이아웃",
      "2 col",
      "3 col",
      "4 col",
      "두 열",
      "세 열",
      "네 열",
      "2열",
      "3열",
      "4열",
    ],
    command: ({ editor }) => runColumnLayoutCommand(editor),
  }),
  slashLeaf({
    id: "youtube",
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
  }),
  slashLeaf({
    title: "페이지 링크",
    description: "다른 페이지 멘션 (@)",
    icon: AtSign,
    keywords: ["mention", "page", "link", "멘션", "페이지"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // 삭제 후 커서 위치를 읽어 mention search 모달 열기
      const { from, to } = editor.state.selection;
      editor.view.dom.dispatchEvent(
        new CustomEvent("qn:open-mention-search", {
          bubbles: true,
          detail: { from, to },
        }),
      );
    },
  }),
  ...dbSlashChildren,
];
