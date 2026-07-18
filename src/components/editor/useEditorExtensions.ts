import { useMemo } from "react";
import StarterKit from "@tiptap/starter-kit";
import { NodeRange } from "@tiptap/extension-node-range";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ImageBlock } from "../../lib/tiptapExtensions/imageBlock";
import { DividerRule } from "../../lib/tiptapExtensions/dividerRule";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { YoutubeBlock } from "../../lib/tiptapExtensions/youtubeBlock";
import {
  InsertBeforeBlock,
} from "../../lib/tiptapExtensions/insertBeforeBlock";
import { Indentation } from "../../lib/tiptapExtensions/indentation";
import { OrderedListMarkdownShortcut } from "../../lib/tiptapExtensions/orderedListShortcut";
import { ListItemPermissive } from "../../lib/tiptapExtensions/listItemPermissive";
import { BracketAutoClose } from "../../lib/tiptapExtensions/bracketAutoClose";
import { InlineCodeShortcut } from "../../lib/tiptapExtensions/inlineCodeShortcut";
import { ArrowShortcuts } from "../../lib/tiptapExtensions/arrowShortcuts";
import TextAlign from "@tiptap/extension-text-align";
import type { createLowlight } from "lowlight";
import { PageContext } from "../../lib/tiptapExtensions/pageContext";
import { SlashCommand } from "../../lib/tiptapExtensions/slashCommand";
import { MoveBlock } from "../../lib/tiptapExtensions/moveBlock";
import { DeleteCurrentBlock } from "../../lib/tiptapExtensions/deleteCurrentBlock";
import { Callout } from "../../lib/tiptapExtensions/callout";
import {
  Toggle,
  ToggleHeader,
  ToggleContent,
} from "../../lib/tiptapExtensions/toggle";
import { ColumnLayout, Column } from "../../lib/tiptapExtensions/columns";
import { TabBlock, TabPanel } from "../../lib/tiptapExtensions/tabBlock";
import {
  CodeBlockLowlightWithMarkdownPreview,
  CodeBlockWithMarkdownPreview,
} from "../../lib/tiptapExtensions/markdownCodeBlockPreview";
import { CodeBlockCopy } from "../../lib/tiptapExtensions/codeBlockCopy";
import { BlockquoteNoInput } from "../../lib/tiptapExtensions/blockquote";
import { MentionExtension } from "../../lib/tiptapExtensions/mention";
import { EmojiShortcode } from "../../lib/tiptapExtensions/emojiShortcode";
import {
  filterSlashMenuEntries,
  type SlashMenuEntry,
} from "../../lib/tiptapExtensions/slashItems";
import { DatabaseBlock } from "../../lib/tiptapExtensions/databaseBlock";
import { FlowchartBlock } from "../../lib/tiptapExtensions/flowchartBlock";
import {
  DropdownMenuBlock,
  GalleryBlock,
} from "../../lib/tiptapExtensions/sharedBlocks";
import { PageLink } from "../../lib/tiptapExtensions/pageLink";
import { ButtonBlock } from "../../lib/tiptapExtensions/buttonBlock";
import { BookmarkBlock } from "../../lib/tiptapExtensions/bookmarkBlock";
import { LucideInlineIcon } from "../../lib/tiptapExtensions/lucideInlineIcon";
import { ImageInlineIcon } from "../../lib/tiptapExtensions/imageInlineIcon";
import { DateInline } from "../../lib/tiptapExtensions/dateInline";
import { FileBlock } from "../../lib/tiptapExtensions/fileBlock";
import { BlockBackground } from "../../lib/tiptapExtensions/blockBackground";
import UniqueID from "@tiptap/extension-unique-id";
import {
  createBlockCommentDecorations,
} from "../../lib/tiptapExtensions/blockCommentDecorations";
import {
  EDITOR_UNIQUE_ID_TYPES,
} from "../../lib/blocks/editorPolicy";
import {
  isAllowedTipTapLinkUri,
} from "../../lib/safeUrl";
import { createSlashRenderer } from "./slashRenderer";
import { editorUniqueIdFilterTransaction } from "./editorUniqueIdFilter";
import { Collaboration } from "../../lib/tiptapExtensions/collaboration";

type LowlightApi = ReturnType<typeof createLowlight>;

type UseEditorExtensionsParams = {
  lowlightApi: LowlightApi | null;
  isFullPageDatabase: boolean;
  effectivePageId: string | null | undefined;
  myMemberId: string | undefined;
  /** 협업 모드일 때 바인딩할 Y.Doc. null 이면 비협업(현행). */
  collabDoc: import("yjs").Doc | null;
  /** 협업 모드일 때 presence 를 공유할 Awareness. null 이면 비협업(현행). */
  collabAwareness: import("y-protocols/awareness").Awareness | null;
};

/**
 * 에디터 extension 목록을 생성하는 훅.
 * lowlightApi 로드 완료 시 CodeBlock extension 이 교체된다.
 */
export function useEditorExtensions({
  lowlightApi,
  isFullPageDatabase,
  effectivePageId,
  myMemberId,
  collabDoc,
  collabAwareness,
}: UseEditorExtensionsParams) {
  const extensions = useMemo(
    () => [
      PageContext,
      NodeRange.configure({}),
      StarterKit.configure({
        // 기본 codeBlock 은 첫 프레임에 원본 마크다운을 노출하므로 항상 별도 NodeView 로 교체한다.
        codeBlock: false,
        blockquote: false,
        orderedList: false,
        // listItem 은 ListItemPermissive 로 교체 — content 를 "block+" 으로 완화해
        // 글머리 항목 안에 이미지/동영상/파일/콜아웃 등 어떤 블록이든 직접 들어갈 수 있게 한다.
        listItem: false,
        // 아래는 동일 이름으로 별도 등록하므로 StarterKit 쪽은 끈다.
        link: false,
        horizontalRule: false,
        // 협업 모드에서는 네이티브 undo/redo 를 끄고 Collaboration(Yjs) 히스토리로 일원화한다.
        undoRedo: collabDoc ? false : undefined,
        dropcursor: {
          color: false,
          width: 2,
          class: "qn-dropcursor",
        },
      }),
      BlockquoteNoInput,
      OrderedListMarkdownShortcut,
      ListItemPermissive,
      Placeholder.configure({
        placeholder: "/ 를 입력해 명령 보기...",
      }),
      Link.configure({
        openOnClick: false,
        // protocols 를 넣으면 linkifyjs에 registerCustomProtocol이 돌아가는데,
        // 자동 링크·붙여넣기가 먼저 쓰인 뒤면 "already initialized" 경고가 난다.
        // http/https/mailto/tel 은 Link 기본 isAllowedUri에 이미 포함되므로 생략한다.
        isAllowedUri: isAllowedTipTapLinkUri,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      lowlightApi
        ? CodeBlockLowlightWithMarkdownPreview.configure({
            lowlight: lowlightApi,
            /* null + fallbackLanguage: highlightAuto 없이 고정 언어로만 강조(입력 중 색 요동 방지) */
            defaultLanguage: null,
            fallbackLanguage: "javascript",
            HTMLAttributes: {
              class: "hljs qn-code-block not-prose",
            },
          })
        : CodeBlockWithMarkdownPreview.configure({
            defaultLanguage: null,
            HTMLAttributes: {
              class: "hljs qn-code-block not-prose",
            },
          }),
      CodeBlockCopy,
      // 대용량 data: URL 을 문서 JSON 에 넣지 않음 — 이미지는 v4 S3 ref(quicknote-image://) 사용.
      ImageBlock.configure({ allowBase64: false }),
      // 동영상·PDF·zip 등 모든 파일은 fileBlock 으로 통합. mimeType 에 따라 NodeView 가 분기.
      FileBlock,
      DividerRule,
      MoveBlock,
      DeleteCurrentBlock,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      YoutubeBlock.configure({ width: 560, height: 315, nocookie: true }),
      Callout,
      ColumnLayout,
      Column,
      TabBlock,
      TabPanel,
      Toggle,
      ToggleHeader,
      ToggleContent,
      MentionExtension,
      createBlockCommentDecorations(effectivePageId ?? undefined, myMemberId),
      EmojiShortcode,
      DatabaseBlock,
      FlowchartBlock,
      DropdownMenuBlock,
      GalleryBlock,
      PageLink,
      ButtonBlock,
      BookmarkBlock,
      InsertBeforeBlock,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LucideInlineIcon,
      ImageInlineIcon,
      DateInline,
      BlockBackground,
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          command: ({ editor, range, props }) => {
            const e = props as SlashMenuEntry;
            if (e.kind === "leaf") {
              e.command({ editor, range });
            }
          },
          items: ({ editor, query }) => filterSlashMenuEntries(query, editor).slice(0, 40),
          render: createSlashRenderer,
          shouldShow: ({ editor }) => {
            const { $from } = editor.state.selection;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "codeBlock") return false;
            }
            return true;
          },
        },
      }),
      Indentation,
      InlineCodeShortcut,
      ArrowShortcuts,
      BracketAutoClose,
      UniqueID.configure({
        types: EDITOR_UNIQUE_ID_TYPES,
        updateDocument: !isFullPageDatabase,
        /** 짧은 텍스트 입력마다 appendTransaction 생략 → youtube·임베드 불필요 갱신 방지 */
        filterTransaction: editorUniqueIdFilterTransaction,
      }),
      // 협업 ON 일 때만 Y.Doc 에 바인딩되는 Collaboration extension 주입.
      ...(collabDoc ? [Collaboration.configure({ doc: collabDoc, awareness: collabAwareness })] : []),
    ],
    [lowlightApi, isFullPageDatabase, effectivePageId, myMemberId, collabDoc, collabAwareness],
  );

  return extensions;
}
