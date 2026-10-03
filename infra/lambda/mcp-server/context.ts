// MCP 서버 공용 컨텍스트 — DDB 클라이언트·테이블명·요청 주체(토큰 소유 Member).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Member } from "../v5-resolvers/handlers/_auth";
import type { Tables } from "../v5-resolvers/handlers/member";
import type { McpTokenRecord } from "../_shared/mcpToken";

export type McpTables = Tables & {
  Pages: string;
  Databases: string;
  Comments: string;
  McpTokens: string;
  /** 토큰별 분당 호출 카운터(ai-usage 테이블 공용, pk=mcp-rl#tokenId). */
  RateLimit: string;
  // 쓰기 툴이 재사용하는 upsertPage·upsertComment 의 부수 효과(히스토리·자산·색인·알림) 테이블.
  PageHistory: string;
  AssetUsage: string;
  ImageAssets: string;
  Schedules: string;
  DatabaseRowMembers: string;
  Notifications: string;
};

export type McpContext = {
  doc: DynamoDBDocumentClient;
  tables: McpTables;
  caller: Member;
  token: McpTokenRecord;
  /** 협업 룸 키 세대(클라 VITE_COLLAB_ROOM_EPOCH 와 동일해야 함). */
  collabRoomEpoch: string;
};

/** 툴 호출 결과로 사용자에게 그대로 보여줄 오류(권한·입력·없음). 내부 오류와 구분한다. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

let cachedDoc: DynamoDBDocumentClient | null = null;

export function defaultDocClient(): DynamoDBDocumentClient {
  if (!cachedDoc) cachedDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return cachedDoc;
}

function env(name: string): string {
  return process.env[name] ?? "";
}

/** Lambda env → 테이블명. 누락 여부는 handler 가 요청 처리 전에 검사한다. */
export function tablesFromEnv(): McpTables {
  return {
    Members: env("MEMBERS_TABLE_NAME"),
    Teams: env("TEAMS_TABLE_NAME"),
    MemberTeams: env("MEMBER_TEAMS_TABLE_NAME"),
    Workspaces: env("WORKSPACES_TABLE_NAME"),
    WorkspaceAccess: env("WORKSPACE_ACCESS_TABLE_NAME"),
    Pages: env("PAGES_TABLE_NAME"),
    Databases: env("DATABASES_TABLE_NAME"),
    Comments: env("COMMENTS_TABLE_NAME"),
    McpTokens: env("MCP_TOKENS_TABLE_NAME"),
    RateLimit: env("MCP_RATE_LIMIT_TABLE_NAME"),
    PageHistory: env("PAGE_HISTORY_TABLE_NAME"),
    AssetUsage: env("ASSET_USAGE_TABLE_NAME"),
    ImageAssets: env("IMAGE_ASSETS_TABLE_NAME"),
    Schedules: env("SCHEDULES_TABLE_NAME"),
    DatabaseRowMembers: env("DATABASE_ROW_MEMBERS_TABLE_NAME"),
    Notifications: env("NOTIFICATIONS_TABLE_NAME"),
  };
}

export function missingTables(tables: McpTables): string[] {
  return Object.entries(tables)
    .filter(([, v]) => typeof v === "string" && v === "")
    .map(([k]) => k);
}
