#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CognitoStack } from "../lib/cognito-stack";
import { QuicknoteSyncStack } from "../lib/sync-stack";
import { QuicknoteRealtimeCollabStack } from "../lib/realtime-collab-stack";

const app = new cdk.App();

// DEPLOY_ENV=dev → dev 스택 (dev- 접두사), 미지정·live → live 스택 (기존 리소스 이름 유지)
const deployEnv = (process.env.DEPLOY_ENV ?? "live") as "dev" | "live";
const isDev = deployEnv === "dev";
const envPrefix = isDev ? "dev-" : "";
const stackPrefix = isDev ? "Dev" : "";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2",
};

// dev 환경 값은 코드에서 직접 지정. live 환경은 cdk.json context 사용.
const cognitoDomainPrefix = isDev
  ? "quicknote-auth-dev"
  : (app.node.tryGetContext("cognitoDomainPrefix") as string);

const webCallbackUrls: string[] = isDev
  ? [
      "http://localhost:5173/auth/callback",
      "https://quick-note-git-develop-zzamjak-4139s-projects.vercel.app/auth/callback",
    ]
  : (app.node.tryGetContext("webCallbackUrls") as string[]);

const webLogoutUrls: string[] = isDev
  ? [
      "http://localhost:5173/auth/signout",
      "https://quick-note-git-develop-zzamjak-4139s-projects.vercel.app/auth/signout",
    ]
  : (app.node.tryGetContext("webLogoutUrls") as string[]);

const membersTableName = isDev
  ? `${envPrefix}quicknote-members-v6`
  : (app.node.tryGetContext("membersTableName") as string | undefined);

const cognitoStack = new CognitoStack(app, `${stackPrefix}QuicknoteCognitoStack`, {
  env,
  envPrefix,
  description: `QuickNote [${deployEnv}] 인증 스택 (User Pool + Google IdP + 화이트리스트 Lambda)`,
  cognitoDomainPrefix,
  webCallbackUrls,
  webLogoutUrls,
  desktopCallbackUrls: app.node.tryGetContext("desktopCallbackUrls") as string[],
  desktopLogoutUrls: app.node.tryGetContext("desktopLogoutUrls") as string[],
  googleSecretName: app.node.tryGetContext("googleSecretName") as string,
  membersTableName,
});

const imagesBucketName =
  (app.node.tryGetContext("imagesBucketName") as string | undefined) ??
  `${envPrefix}quicknote-images-${env.account ?? "unknown"}-${env.region}`;

const syncStack = new QuicknoteSyncStack(app, `${stackPrefix}QuicknoteSyncStack`, {
  env,
  envPrefix,
  description: `QuickNote [${deployEnv}] 동기화 스택 (AppSync + DDB + S3 + Lambda)`,
  userPoolId: cognitoStack.userPoolId,
  userPoolArn: cognitoStack.userPoolArn,
  imagesBucketName,
  membersTableName,
  teamsTableName: isDev
    ? `${envPrefix}quicknote-teams-v6`
    : (app.node.tryGetContext("teamsTableName") as string | undefined),
  memberTeamsTableName: isDev
    ? `${envPrefix}quicknote-member-teams-v6`
    : (app.node.tryGetContext("memberTeamsTableName") as string | undefined),
  workspacesTableName: isDev
    ? `${envPrefix}quicknote-workspaces-v6`
    : (app.node.tryGetContext("workspacesTableName") as string | undefined),
  workspaceAccessTableName: isDev
    ? `${envPrefix}quicknote-workspace-access-v6`
    : (app.node.tryGetContext("workspaceAccessTableName") as string | undefined),
});

// 실시간 협업 스택 — WS API + Yjs 테이블 + Lambda.
// 기본은 Cognito/Sync 스택에서 교차참조로 주입한다(live·전체 배포 시).
// 단, 단일 스택만 격리 배포할 때는 교차참조(Fn::ImportValue)가 생기면 생산 스택까지
// 함께 갱신해야 하므로, COLLAB_* 환경변수가 주어지면 그 리터럴 값을 사용해 교차참조를 끊는다.
new QuicknoteRealtimeCollabStack(app, `${stackPrefix}QuicknoteRealtimeCollabStack`, {
  env,
  envPrefix,
  description: `QuickNote [${deployEnv}] 실시간 협업 스택 (WS API + DDB + Lambda)`,
  userPoolId: process.env.COLLAB_USER_POOL_ID ?? cognitoStack.userPoolId,
  userPoolClientId: process.env.COLLAB_WEB_CLIENT_ID ?? cognitoStack.webClientId,
  pageTableName: process.env.COLLAB_PAGE_TABLE_NAME ?? syncStack.pageTable.table.tableName,
  pageTableArn: process.env.COLLAB_PAGE_TABLE_ARN ?? syncStack.pageTable.table.tableArn,
});
