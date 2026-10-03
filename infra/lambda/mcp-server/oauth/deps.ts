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
  /** 이 요청이 origin-verify 를 통과했는지(=CloudFront 경유) — 뷰어 IP 헤더 신뢰 조건. */
  viaEdge: boolean;
};
