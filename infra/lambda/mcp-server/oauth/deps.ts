// OAuth 파사드 의존성 — 테스트에서 DDB·Cognito·시계를 주입한다.
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { McpTables } from "../context";
import type { CognitoOps } from "./cognito";
import type { OAuthConfig } from "./config";

export type OAuthDeps = {
  doc: DynamoDBDocumentClient;
  tables: McpTables;
  config: OAuthConfig;
  cognito: CognitoOps;
  now: () => Date;
};
