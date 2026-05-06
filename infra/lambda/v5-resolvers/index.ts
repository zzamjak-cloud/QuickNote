// AppSync Lambda 리졸버 라우터. ctx.info.fieldName 으로 분기.
// 각 핸들러는 handlers/ 아래에 분리. 본 파일은 라우팅 + 공통 에러 응답만.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getCallerMember, ResolverError } from "./handlers/_auth";
import { createMember, listMembers, getMember } from "./handlers/member";
import type { Tables } from "./handlers/member";

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

const tables: Tables = {
  Members: process.env.MEMBERS_TABLE_NAME!,
  Teams: process.env.TEAMS_TABLE_NAME!,
  MemberTeams: process.env.MEMBER_TEAMS_TABLE_NAME!,
  Workspaces: process.env.WORKSPACES_TABLE_NAME!,
  WorkspaceAccess: process.env.WORKSPACE_ACCESS_TABLE_NAME!,
};

type AppsyncEvent = {
  arguments: Record<string, unknown>;
  identity?: { sub?: string };
  info: { fieldName: string };
};

export async function handler(event: AppsyncEvent): Promise<unknown> {
  try {
    const caller = await getCallerMember(doc, tables.Members, event.identity?.sub);
    const args = { doc, tables, caller, ...event.arguments };

    switch (event.info.fieldName) {
      case "me":
        return caller;
      case "createMember":
        return await createMember({ ...args, input: event.arguments.input });
      case "listMembers":
        return await listMembers({ ...args, filter: event.arguments.filter });
      case "getMember":
        return await getMember({ ...args, memberId: event.arguments.memberId });
      default:
        throw new ResolverError(`unknown fieldName: ${event.info.fieldName}`, "InternalError");
    }
  } catch (err) {
    if (err instanceof ResolverError) {
      return errorResponse(err.message, err.errorType);
    }
    console.error("v5-resolvers unexpected error", err);
    return errorResponse(
      err instanceof Error ? err.message : String(err),
      "InternalError",
    );
  }
}

function errorResponse(message: string, errorType: string) {
  // AppSync Lambda 리졸버는 errorType/data 필드 형태로 에러 노출 가능.
  // 또는 resolver mapping template 에서 $util.error() 처리.
  // 가장 단순한 방식: throw 해서 AppSync 가 errors 배열에 담도록.
  const e = new Error(message) as Error & { errorType: string };
  e.errorType = errorType;
  throw e;
}
