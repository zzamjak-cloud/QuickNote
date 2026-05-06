import type { PostConfirmationTriggerEvent, PostConfirmationTriggerHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Cognito 가입 직후 호출. PreSignUp 에서 Member 존재 확인이 끝난 상태이므로
// 여기서 cognitoSub 만 채우면 된다. 멱등하게 동작 (이미 채워졌어도 재실행 가능).
export async function linkCognitoSub(
  email: string,
  cognitoSub: string,
  tableName: string,
  send: typeof docClient.send,
): Promise<void> {
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
  if (!m) {
    // PreSignUp 이 정상이면 여기 도달 불가. 시스템 에러로 throw.
    throw new Error(`PostConfirmation: Member not found for ${lower}`);
  }
  await send(
    new UpdateCommand({
      TableName: tableName,
      Key: { memberId: m.memberId },
      UpdateExpression: "SET cognitoSub = :s",
      ExpressionAttributeValues: { ":s": cognitoSub },
    }),
  );
}

export const handler: PostConfirmationTriggerHandler = async (
  event: PostConfirmationTriggerEvent,
) => {
  const tableName = process.env.MEMBERS_TABLE_NAME!;
  const email = event.request.userAttributes?.email;
  const sub = event.request.userAttributes?.sub;
  if (email && sub) {
    await linkCognitoSub(email, sub, tableName, docClient.send.bind(docClient));
  }
  return event;
};
