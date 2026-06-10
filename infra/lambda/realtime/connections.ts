import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CONNECTIONS_TABLE!;
const TTL_SECONDS = 3 * 60 * 60; // 좀비 연결 방지(최대 3시간)

export async function joinRoom(args: {
  connectionId: string; pageId: string; userId: string; workspaceId: string;
}): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { ...args, connectedAt: Date.now(), ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS },
  }));
}

export async function leaveRoom(connectionId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { connectionId } }));
}

export async function roomConnections(pageId: string): Promise<string[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE, IndexName: "byPageId",
    KeyConditionExpression: "pageId = :p", ExpressionAttributeValues: { ":p": pageId },
    ProjectionExpression: "connectionId",
  }));
  return (res.Items ?? []).map((i) => i.connectionId as string);
}
