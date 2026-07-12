// AI tool use 스키마 — 실행은 클라이언트 로컬 스토어에서, Lambda 는 스키마·중계만.

export type AiToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

/** user 메시지에 첨부되는 이미지 — base64 인라인(제공사 멀티모달 입력으로 전달). */
export type AiImageAttachment = { mimeType: string; dataBase64: string };

export type AiWireMessage =
  | { role: "user"; content: string; images?: AiImageAttachment[] }
  | { role: "assistant"; content: string }
  | { role: "assistant_tools"; toolCalls: AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

const LIST_ROWS_PARAMS = {
  type: "object",
  properties: {
    databaseId: { type: "string", description: "데이터베이스 ID" },
    filter: {
      type: "string",
      description: "제목·셀 텍스트 검색어(선택)",
    },
    limit: {
      type: "number",
      description: "반환 행 상한(기본 30, 최대 50)",
    },
  },
  required: ["databaseId"],
} as const;

const GET_ROW_PARAMS = {
  type: "object",
  properties: {
    rowId: {
      type: "string",
      description: "행 페이지 ID(list_rows 의 rowId)",
    },
  },
  required: ["rowId"],
} as const;

const GET_PAGE_PARAMS = {
  type: "object",
  properties: {
    pageId: { type: "string", description: "페이지 ID" },
  },
  required: ["pageId"],
} as const;

export const AI_TOOL_NAMES = ["list_rows", "get_row", "get_page_content"] as const;

/** Anthropic Messages API tools 배열. */
export function anthropicTools() {
  return [
    {
      name: "list_rows",
      description:
        "데이터베이스 행 목록을 조회한다. 필터·한도로 후보를 좁힌 뒤 필요한 행만 get_row/get_page_content 로 본다.",
      input_schema: LIST_ROWS_PARAMS,
    },
    {
      name: "get_row",
      description: "특정 행의 셀 값과 요약 정보를 가져온다.",
      input_schema: GET_ROW_PARAMS,
    },
    {
      name: "get_page_content",
      description: "페이지(또는 행 항목) 본문 마크다운을 가져온다.",
      input_schema: GET_PAGE_PARAMS,
    },
  ];
}

/** Gemini functionDeclarations. */
export function geminiFunctionDeclarations() {
  return [
    {
      name: "list_rows",
      description:
        "데이터베이스 행 목록을 조회한다. 필터·한도로 후보를 좁힌 뒤 필요한 행만 get_row/get_page_content 로 본다.",
      parameters: LIST_ROWS_PARAMS,
    },
    {
      name: "get_row",
      description: "특정 행의 셀 값과 요약 정보를 가져온다.",
      parameters: GET_ROW_PARAMS,
    },
    {
      name: "get_page_content",
      description: "페이지(또는 행 항목) 본문 마크다운을 가져온다.",
      parameters: GET_PAGE_PARAMS,
    },
  ];
}

export const TOOLS_SYSTEM_HINT = [
  "필요하면 도구로 추가 데이터를 조회할 수 있다:",
  "- list_rows(databaseId, filter?, limit?): 행 목록",
  "- get_row(rowId): 행 셀 상세",
  "- get_page_content(pageId): 페이지/행 본문",
  "컨텍스트에 없는 세부 본문·누락 행은 추측하지 말고 도구로 확인한다.",
].join("\n");
