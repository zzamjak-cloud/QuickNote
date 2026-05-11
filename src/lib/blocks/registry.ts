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

export type BlockEditorPolicy = {
  /** UniqueID extension 대상에서 제외할지 여부 */
  excludeFromUniqueId?: boolean;
  /** 타입 변경 전 wrapper를 풀어야 하는 컨테이너형 블록인지 */
  flattenBeforeTypeChange?: boolean;
  /** 블록 핸들을 숨겨야 하는 내부 구조 노드인지 */
  suppressBlockHandle?: boolean;
};

export type BlockSerializationPolicy = {
  /** 저장된 attrs/doc 구조 변경 시 사용할 블록 단위 schema version */
  schemaVersion: number;
  /** 향후 export/import, sanitize, migration에서 참조할 안정 키 */
  stableType: string;
};

export type BlockToolbarPolicy = {
  kind: "none" | "text" | "media" | "database" | "container";
};

export type BlockCommandPolicy = {
  slashTitles: string[];
};

export type BlockDefinition = {
  id: string;
  title: string;
  nodeTypes: string[];
  group: BlockGroup;
  dnd: BlockDndPolicy;
  editor: BlockEditorPolicy;
  serialization: BlockSerializationPolicy;
  toolbar: BlockToolbarPolicy;
  command: BlockCommandPolicy;
  /** @deprecated command.slashTitles 를 사용한다. */
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

function defineBlock(
  input: Omit<BlockDefinition, "editor" | "serialization" | "toolbar" | "command"> &
    Partial<Pick<BlockDefinition, "editor" | "serialization" | "toolbar" | "command">>,
): BlockDefinition {
  return {
    ...input,
    editor: input.editor ?? {},
    serialization: input.serialization ?? {
      schemaVersion: 1,
      stableType: input.id,
    },
    toolbar: input.toolbar ?? { kind: "text" },
    command: input.command ?? { slashTitles: input.slashTitles },
  };
}

export const blockDefinitions: BlockDefinition[] = [
  defineBlock({
    id: "paragraph",
    title: "본문",
    nodeTypes: ["paragraph"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["본문"],
  }),
  defineBlock({
    id: "heading",
    title: "제목",
    nodeTypes: ["heading"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["제목 1", "제목 2", "제목 3"],
  }),
  defineBlock({
    id: "list",
    title: "목록",
    nodeTypes: ["bulletList", "orderedList", "taskList", "listItem", "taskItem"],
    group: "list",
    dnd: containerDnd,
    slashTitles: ["글머리 기호 목록", "번호 목록", "할 일"],
  }),
  defineBlock({
    id: "codeBlock",
    title: "코드 블록",
    nodeTypes: ["codeBlock"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["코드 블록"],
  }),
  defineBlock({
    id: "blockquote",
    title: "인용",
    nodeTypes: ["blockquote"],
    group: "text",
    dnd: containerDnd,
    slashTitles: ["인용"],
  }),
  defineBlock({
    id: "horizontalRule",
    title: "구분선",
    nodeTypes: ["horizontalRule"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["구분선"],
  }),
  defineBlock({
    id: "image",
    title: "이미지",
    nodeTypes: ["image"],
    group: "media",
    dnd: movableLeafDnd,
    toolbar: { kind: "media" },
    slashTitles: ["이미지"],
  }),
  defineBlock({
    id: "file",
    title: "파일",
    nodeTypes: ["fileBlock"],
    group: "media",
    dnd: movableLeafDnd,
    editor: { excludeFromUniqueId: true },
    toolbar: { kind: "media" },
    slashTitles: [],
  }),
  defineBlock({
    id: "pageMention",
    title: "페이지 링크",
    nodeTypes: ["mention", "pageLink"],
    group: "text",
    dnd: movableLeafDnd,
    slashTitles: ["새 페이지", "페이지 링크"],
  }),
  defineBlock({
    id: "database",
    title: "DB",
    nodeTypes: ["databaseBlock"],
    group: "database",
    dnd: movableLeafDnd,
    toolbar: { kind: "database" },
    slashTitles: ["DB - 전체 페이지", "DB - 인라인"],
  }),
  defineBlock({
    id: "table",
    title: "표",
    nodeTypes: ["table", "tableRow", "tableHeader", "tableCell"],
    group: "database",
    dnd: containerDnd,
    toolbar: { kind: "container" },
    slashTitles: ["표"],
  }),
  defineBlock({
    id: "button",
    title: "버튼",
    nodeTypes: ["buttonBlock"],
    group: "interactive",
    dnd: movableLeafDnd,
    slashTitles: ["버튼"],
  }),
  defineBlock({
    id: "bookmark",
    title: "북마크",
    nodeTypes: ["bookmarkBlock"],
    group: "embed",
    dnd: movableLeafDnd,
    toolbar: { kind: "media" },
    slashTitles: [],
  }),
  defineBlock({
    id: "callout",
    title: "콜아웃",
    nodeTypes: ["callout"],
    group: "text",
    dnd: containerDnd,
    editor: { flattenBeforeTypeChange: true },
    toolbar: { kind: "container" },
    slashTitles: ["콜아웃"],
  }),
  defineBlock({
    id: "toggle",
    title: "토글",
    nodeTypes: ["toggle", "toggleHeader", "toggleContent"],
    group: "text",
    dnd: containerDnd,
    editor: { flattenBeforeTypeChange: true },
    toolbar: { kind: "container" },
    slashTitles: ["토글", "제목 토글 목록 1", "제목 토글 목록 2", "제목 토글 목록 3"],
  }),
  defineBlock({
    id: "columns",
    title: "컬럼",
    nodeTypes: ["columnLayout", "column"],
    group: "layout",
    dnd: {
      allowInsideColumns: false,
      allowInsideTabs: true,
      acceptsChildren: true,
    },
    editor: { suppressBlockHandle: true },
    toolbar: { kind: "container" },
    slashTitles: ["컬럼"],
  }),
  defineBlock({
    id: "tabs",
    title: "탭",
    nodeTypes: ["tabBlock", "tabPanel"],
    group: "layout",
    dnd: {
      allowInsideColumns: true,
      allowInsideTabs: true,
      acceptsChildren: true,
    },
    editor: { suppressBlockHandle: true },
    toolbar: { kind: "container" },
    slashTitles: ["탭"],
  }),
  defineBlock({
    id: "youtube",
    title: "유튜브 임베드",
    nodeTypes: ["youtube"],
    group: "embed",
    dnd: movableLeafDnd,
    editor: { excludeFromUniqueId: true },
    toolbar: { kind: "media" },
    slashTitles: ["유튜브 임베드"],
  }),
  defineBlock({
    id: "emoji",
    title: "이모지",
    nodeTypes: ["emoji", "lucideInlineIcon"],
    group: "interactive",
    dnd: movableLeafDnd,
    editor: { excludeFromUniqueId: true },
    toolbar: { kind: "none" },
    slashTitles: ["이모지"],
  }),
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
