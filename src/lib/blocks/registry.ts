import { slashMenuEntries } from "../tiptapExtensions/slashMenu/menuEntries";
import type { SlashMenuEntry } from "../tiptapExtensions/slashMenu/types";

export type BlockGroup =
  | "text"
  | "list"
  | "media"
  | "layout"
  | "database"
  | "embed"
  | "interactive";

export type BlockDndPolicy = {
  /** 컬럼 블럭 내부로 이동할 수 있는지 */
  allowInsideColumns: boolean;
  /** 탭 패널 내부로 이동할 수 있는지 */
  allowInsideTabs: boolean;
  /** 다른 블럭을 자식 컨텐츠로 품을 수 있는지 */
  acceptsChildren: boolean;
};

export type BlockDefinition = {
  id: string;
  title: string;
  nodeTypes: string[];
  group: BlockGroup;
  dnd: BlockDndPolicy;
  slashTitles: string[];
};

const movableLeafDnd: BlockDndPolicy = {
  allowInsideColumns: true,
  allowInsideTabs: true,
  acceptsChildren: false,
};

const containerDnd: BlockDndPolicy = {
  allowInsideColumns: true,
  allowInsideTabs: true,
  acceptsChildren: true,
};

export const blockDefinitions: BlockDefinition[] = [
  {
    id: "paragraph",
    title: "본문",
    nodeTypes: ["paragraph"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["본문"],
  },
  {
    id: "heading",
    title: "제목",
    nodeTypes: ["heading"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["제목 1", "제목 2", "제목 3"],
  },
  {
    id: "list",
    title: "목록",
    nodeTypes: ["bulletList", "orderedList", "taskList", "listItem", "taskItem"],
    group: "list",
    dnd: containerDnd,
    slashTitles: ["글머리 기호 목록", "번호 목록", "할 일"],
  },
  {
    id: "codeBlock",
    title: "코드 블록",
    nodeTypes: ["codeBlock"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["코드 블록"],
  },
  {
    id: "blockquote",
    title: "인용",
    nodeTypes: ["blockquote"],
    group: "text",
    dnd: containerDnd,
    slashTitles: ["인용"],
  },
  {
    id: "horizontalRule",
    title: "구분선",
    nodeTypes: ["horizontalRule"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["구분선"],
  },
  {
    id: "image",
    title: "이미지",
    nodeTypes: ["image"],
    group: "media",
    dnd: movableLeafDnd,
    slashTitles: ["이미지"],
  },
  {
    id: "file",
    title: "파일",
    nodeTypes: ["fileBlock"],
    group: "media",
    dnd: movableLeafDnd,
    slashTitles: [],
  },
  {
    id: "pageMention",
    title: "페이지 링크",
    nodeTypes: ["mention", "pageLink"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["새 페이지", "페이지 링크"],
  },
  {
    id: "database",
    title: "DB",
    nodeTypes: ["databaseBlock"],
    group: "database",
    dnd: movableLeafDnd,
    slashTitles: ["DB"],
  },
  {
    id: "table",
    title: "표",
    nodeTypes: ["table", "tableRow", "tableHeader", "tableCell"],
    group: "database",
    dnd: containerDnd,
    slashTitles: ["표"],
  },
  {
    id: "button",
    title: "버튼",
    nodeTypes: ["buttonBlock"],
    group: "interactive",
    dnd: movableLeafDnd,
    slashTitles: ["버튼"],
  },
  {
    id: "callout",
    title: "콜아웃",
    nodeTypes: ["callout"],
    group: "text",
    dnd: containerDnd,
    slashTitles: ["콜아웃"],
  },
  {
    id: "toggle",
    title: "토글",
    nodeTypes: ["toggle", "toggleHeader", "toggleContent"],
    group: "text",
    dnd: containerDnd,
    slashTitles: ["토글", "제목 토글 목록 1", "제목 토글 목록 2", "제목 토글 목록 3"],
  },
  {
    id: "columns",
    title: "컬럼",
    nodeTypes: ["columnLayout", "column"],
    group: "layout",
    dnd: {
      allowInsideColumns: false,
      allowInsideTabs: true,
      acceptsChildren: true,
    },
    slashTitles: ["컬럼"],
  },
  {
    id: "tabs",
    title: "탭",
    nodeTypes: ["tabBlock", "tabPanel"],
    group: "layout",
    dnd: {
      allowInsideColumns: true,
      allowInsideTabs: true,
      acceptsChildren: true,
    },
    slashTitles: ["탭"],
  },
  {
    id: "youtube",
    title: "유튜브 임베드",
    nodeTypes: ["youtube"],
    group: "embed",
    dnd: movableLeafDnd,
    slashTitles: ["유튜브 임베드"],
  },
  {
    id: "emoji",
    title: "이모지",
    nodeTypes: ["emoji", "lucideInlineIcon"],
    group: "interactive",
    dnd: movableLeafDnd,
    slashTitles: ["이모지"],
  },
];

const blockDefinitionById = new Map(
  blockDefinitions.map((definition) => [definition.id, definition]),
);

const blockDefinitionByNodeType = new Map<string, BlockDefinition>();
for (const definition of blockDefinitions) {
  for (const nodeType of definition.nodeTypes) {
    blockDefinitionByNodeType.set(nodeType, definition);
  }
}

export function getBlockDefinition(id: string): BlockDefinition | undefined {
  return blockDefinitionById.get(id);
}

export function getBlockDefinitionForNodeType(
  nodeType: string,
): BlockDefinition | undefined {
  return blockDefinitionByNodeType.get(nodeType);
}

export function getSlashMenuEntries(): SlashMenuEntry[] {
  return slashMenuEntries;
}
