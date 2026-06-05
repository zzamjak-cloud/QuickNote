#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CognitoStack } from "../lib/cognito-stack";
import { QuicknoteSyncStack } from "../lib/sync-stack";

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
      // dev Vercel Preview URL — 첫 배포 후 실제 URL을 여기에 추가
      "https://quick-note-develop.vercel.app/auth/callback",
    ]
  : (app.node.tryGetContext("webCallbackUrls") as string[]);

const webLogoutUrls: string[] = isDev
  ? [
      "http://localhost:5173/auth/signout",
      "https://quick-note-develop.vercel.app/auth/signout",
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

new QuicknoteSyncStack(app, `${stackPrefix}QuicknoteSyncStack`, {
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
