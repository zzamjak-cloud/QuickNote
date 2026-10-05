// Cognito 도메인 managed login(v2) 전환과 클라이언트별 기본 스타일.
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vitest";
import { CognitoStack } from "./cognito-stack";
import { McpOAuth } from "./mcp-oauth-construct";

const ENV = { account: "111111111111", region: "ap-northeast-2" };

describe("CognitoStack managed login", () => {
  const stack = new CognitoStack(new cdk.App(), "C", {
    env: ENV,
    envPrefix: "dev-",
    cognitoDomainPrefix: "quicknote-auth-test",
    webCallbackUrls: ["https://app.example.com/callback"],
    webLogoutUrls: ["https://app.example.com/"],
    desktopCallbackUrls: ["quicknote://callback"],
    desktopLogoutUrls: ["quicknote://logout"],
    googleSecretName: "test/google",
  });
  const t = Template.fromStack(stack);

  it("도메인은 같은 접두사로 ManagedLoginVersion 2", () => {
    t.hasResourceProperties("AWS::Cognito::UserPoolDomain", { Domain: "quicknote-auth-test", ManagedLoginVersion: 2 });
  });

  it("웹·데스크톱 클라이언트마다 Cognito 기본 스타일, 도메인은 스타일 뒤에 갱신", () => {
    const brandings = t.findResources("AWS::Cognito::ManagedLoginBranding");
    const clients = t.findResources("AWS::Cognito::UserPoolClient");
    expect(Object.keys(brandings)).toHaveLength(2);
    const brandedClients = Object.values(brandings).map((b) => {
      expect(b.Properties.UseCognitoProvidedValues).toBe(true);
      expect(b.Properties.Settings).toBeUndefined();
      return b.Properties.ClientId.Ref as string;
    });
    expect(brandedClients.sort()).toEqual(Object.keys(clients).sort());
    const [domain] = Object.values(t.findResources("AWS::Cognito::UserPoolDomain"));
    expect([...domain.DependsOn].sort()).toEqual(Object.keys(brandings).sort());
  });
});

describe("McpOAuth 클라이언트 스타일", () => {
  it("파사드 클라이언트에도 Cognito 기본 스타일", () => {
    const stack = new cdk.Stack(new cdk.App(), "S", { env: ENV });
    const userPool = cognito.UserPool.fromUserPoolId(stack, "Pool", "ap-northeast-2_TEST");
    const fn = new lambda.Function(stack, "Fn", { runtime: lambda.Runtime.NODEJS_22_X, handler: "i.h", code: lambda.Code.fromInline("x") });
    const table = (id: string) => new dynamodb.Table(stack, id, { partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING } });
    new McpOAuth(stack, "OAuth", {
      envPrefix: "dev-",
      fn,
      publicOrigin: "https://example.cloudfront.net",
      userPool,
      userPoolId: "ap-northeast-2_TEST",
      cognitoDomainPrefix: "quicknote-auth-test",
      mcpTokensTable: table("Tokens"),
      rateLimitTable: table("Usage"),
    });
    const t = Template.fromStack(stack);
    const [clientId] = Object.keys(t.findResources("AWS::Cognito::UserPoolClient"));
    t.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
      UserPoolId: "ap-northeast-2_TEST",
      ClientId: { Ref: clientId },
      UseCognitoProvidedValues: true,
    });
  });
});
