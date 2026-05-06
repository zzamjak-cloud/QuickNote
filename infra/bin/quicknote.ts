#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CognitoStack } from "../lib/cognito-stack";
import { QuicknoteSyncStack } from "../lib/sync-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2",
};

const cognitoStack = new CognitoStack(app, "QuicknoteCognitoStack", {
  env,
  description: "QuickNote v3 인증 스택 (User Pool + Google IdP + 화이트리스트 Lambda)",
  cognitoDomainPrefix: app.node.tryGetContext("cognitoDomainPrefix") as string,
  webCallbackUrls: app.node.tryGetContext("webCallbackUrls") as string[],
  webLogoutUrls: app.node.tryGetContext("webLogoutUrls") as string[],
  desktopCallbackUrls: app.node.tryGetContext("desktopCallbackUrls") as string[],
  desktopLogoutUrls: app.node.tryGetContext("desktopLogoutUrls") as string[],
  googleSecretName: app.node.tryGetContext("googleSecretName") as string,
});

const imagesBucketName =
  (app.node.tryGetContext("imagesBucketName") as string | undefined)
  ?? `quicknote-images-${env.account ?? "unknown"}-${env.region}`;

new QuicknoteSyncStack(app, "QuicknoteSyncStack", {
  env,
  description: "QuickNote v4 동기화 스택 (AppSync + DDB + S3 + Lambda)",
  userPoolId: cognitoStack.userPoolId,
  userPoolArn: cognitoStack.userPoolArn,
  imagesBucketName,
});
