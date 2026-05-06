import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Members 테이블 GSI(byEmail) 조회 + status=active 검증.
// 테스트 가능하도록 send 를 주입 가능한 형태로 분리.
export async function isMemberAllowed(
  email: string,
  tableName: string,
  send: typeof docClient.send,
): Promise<boolean> {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  const result = await send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "byEmail",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": lower },
      Limit: 1,
    }),
  );
  const m = result.Items?.[0];
  return Boolean(m && m.status === "active");
}

export const handler: PreSignUpTriggerHandler = async (event: PreSignUpTriggerEvent) => {
  const tableName = process.env.MEMBERS_TABLE_NAME!;
  const email = event.request.userAttributes?.email;

  // 등록된 active 멤버만 가입 허용
  const allowed = await isMemberAllowed(email ?? "", tableName, docClient.send.bind(docClient));
  if (!allowed) {
    throw new Error("UNAUTHORIZED_EMAIL");
  }

  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    event.response.autoVerifyEmail = true;
    event.response.autoConfirmUser = true;
  } else {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }
  return event;
};
