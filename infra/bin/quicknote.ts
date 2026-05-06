#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CognitoStack } from "../lib/cognito-stack";

const app = new cdk.App();

// 화이트리스트 이메일은 `cdk deploy -c allowedEmails=a@x.com,b@y.com` 으로 주입한다.
// bootstrap 단계에서도 app 이 합성되므로 비어 있어도 throw 하지 않는다.
// 비어 있으면 Lambda 가 모든 가입을 거부하는 안전한 기본값으로 동작한다.
const allowedEmailsRaw = (app.node.tryGetContext("allowedEmails") as string | undefined) ?? "";
const allowedEmails = allowedEmailsRaw
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2",
};

new CognitoStack(app, "QuicknoteCognitoStack", {
  env,
  description: "QuickNote v3 인증 스택 (User Pool + Google IdP + 화이트리스트 Lambda)",
  cognitoDomainPrefix: app.node.tryGetContext("cognitoDomainPrefix") as string,
  webCallbackUrls: app.node.tryGetContext("webCallbackUrls") as string[],
  webLogoutUrls: app.node.tryGetContext("webLogoutUrls") as string[],
  desktopCallbackUrls: app.node.tryGetContext("desktopCallbackUrls") as string[],
  desktopLogoutUrls: app.node.tryGetContext("desktopLogoutUrls") as string[],
  googleSecretName: app.node.tryGetContext("googleSecretName") as string,
  allowedEmails,
});
