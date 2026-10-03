// MCP CloudFront 앞단 — 엣지 함수 헤더 변환(함수 코드를 그대로 실행)과 배포 설정.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vitest";
import { McpEdge, ORIGIN_VERIFY_HEADER, mcpPublicOriginParamName } from "./mcp-edge-construct";

type Headers = Record<string, { value: string }>;

function edgeHandler(file: string): (event: unknown) => { headers: Headers } {
  const code = readFileSync(path.join(__dirname, "mcp-edge", file), "utf8");
  const sandbox: { handler?: (event: unknown) => { headers: Headers } } = {};
  runInNewContext(`${code}\nthis.handler = handler;`, sandbox);
  return sandbox.handler as (event: unknown) => { headers: Headers };
}

describe("CloudFront 엣지 함수", () => {
  it("viewer-response: x-amzn-remapped-www-authenticate → www-authenticate(원래 이름 삭제)", () => {
    const handler = edgeHandler("viewer-response.js");
    const value = 'Bearer realm="quicknote", resource_metadata="https://d.cloudfront.net/.well-known/oauth-protected-resource/mcp"';
    const out = handler({ response: { statusCode: 401, headers: { "x-amzn-remapped-www-authenticate": { value }, "content-type": { value: "application/json" } } } });
    expect(out.headers["www-authenticate"]).toEqual({ value });
    expect(out.headers["x-amzn-remapped-www-authenticate"]).toBeUndefined();
    expect(out.headers["content-type"]).toEqual({ value: "application/json" });
    const untouched = handler({ response: { headers: { "content-type": { value: "text/plain" } } } });
    expect(Object.keys(untouched.headers)).toEqual(["content-type"]);
  });

  it("viewer-request: 뷰어 IP 를 x-qn-viewer-address 로 싣고, 클라가 보낸 값은 덮어쓴다", () => {
    const handler = edgeHandler("viewer-request.js");
    const out = handler({ viewer: { ip: "203.0.113.7" }, request: { headers: { "x-qn-viewer-address": { value: "1.2.3.4:5" } } } });
    expect(out.headers["x-qn-viewer-address"]).toEqual({ value: "203.0.113.7:0" });
  });
});

describe("McpEdge 배포", () => {
  it("Function URL 원본·캐시 끔·AllViewerExceptHostHeader·압축 끔·HTTP2·원본 보호 헤더·엣지 함수 2개·SSM 공개 origin", () => {
    const stack = new cdk.Stack(new cdk.App(), "T", { env: { account: "111111111111", region: "ap-northeast-2" } });
    const fn = new lambda.Function(stack, "Fn", { runtime: lambda.Runtime.NODEJS_22_X, handler: "i.h", code: lambda.Code.fromInline("x") });
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    new McpEdge(stack, "Edge", { envPrefix: "dev-", fn, fnUrl: url });
    const t = Template.fromStack(stack);
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        HttpVersion: "http2",
        DefaultCacheBehavior: Match.objectLike({
          AllowedMethods: Match.arrayWith(["POST", "DELETE"]),
          CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // Managed-CachingDisabled
          OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", // Managed-AllViewerExceptHostHeader
          Compress: false,
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
            Match.objectLike({ EventType: "viewer-response" }),
          ]),
        }),
        Origins: [Match.objectLike({ OriginCustomHeaders: [Match.objectLike({ HeaderName: ORIGIN_VERIFY_HEADER })] })],
      }),
    });
    const verify = (t.findResources("AWS::CloudFront::Distribution") as Record<string, { Properties: { DistributionConfig: { Origins: { OriginCustomHeaders: { HeaderValue: string }[] }[] } } }>);
    const headerValue = Object.values(verify)[0].Properties.DistributionConfig.Origins[0].OriginCustomHeaders[0].HeaderValue;
    expect(headerValue).toMatch(/^[0-9a-f]{40}$/);
    t.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ ORIGIN_VERIFY: headerValue, MCP_PUBLIC_ORIGIN_PARAM: mcpPublicOriginParamName("dev-") }) },
    });
    t.hasResourceProperties("AWS::SSM::Parameter", { Name: mcpPublicOriginParamName("dev-") });
    expect(Object.keys(t.findOutputs("McpServerUrl"))).toHaveLength(1);
    expect(Object.keys(t.findOutputs("McpServerOriginUrl"))).toHaveLength(1);
  });
});
