// MCP 서버 앞단 CloudFront — Function URL 의 헤더 리매핑(WWW-Authenticate → x-amzn-Remapped-WWW-Authenticate) 때문에
// MCP 클라이언트가 OAuth discovery 를 못 하는 문제를 viewer-response 함수로 복원하고, 공개 origin 을 CloudFront 로 고정한다.
//
// 순환 참조 회피: Distribution → Function URL → 함수 이므로 함수 env 가 배포 도메인을 참조하면 순환이다.
// 공개 origin 은 SSM 파라미터로 게시하고 함수가 런타임에 읽는다(권한 ARN 도 이름으로 구성).
// origin-verify 값은 Secrets Manager 랜덤 비밀이다(저장소가 공개라 결정적 값은 누구나 재현해 원본을 직접 호출할 수 있다).
// CloudFront 원본 헤더에는 CFN 동적 참조({{resolve:secretsmanager:…}})로 넣어 템플릿에 평문이 남지 않고,
// 함수는 env 로 평문을 받지 않고(비밀 이름만) 런타임에 GetSecretValue 로 읽는다.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export const ORIGIN_VERIFY_HEADER = "x-qn-origin-verify";

export interface McpEdgeProps {
  envPrefix: string;
  fn: lambda.Function;
  fnUrl: lambda.FunctionUrl;
}

export function mcpPublicOriginParamName(envPrefix: string): string {
  return `/${envPrefix}quicknote/mcp-public-origin`;
}

export function originVerifySecretName(envPrefix: string): string {
  return `${envPrefix}quicknote/mcp-origin-verify`;
}

function edgeFunction(scope: Construct, id: string, file: string): cloudfront.Function {
  return new cloudfront.Function(scope, id, {
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(readFileSync(path.join(__dirname, "mcp-edge", file), "utf8")),
  });
}

export class McpEdge extends Construct {
  /** https://xxxx.cloudfront.net (끝 슬래시 없음) */
  readonly publicOrigin: string;

  constructor(scope: Construct, id: string, props: McpEdgeProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const secretName = originVerifySecretName(props.envPrefix);
    const secret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      secretName,
      description: "MCP CloudFront → Function URL 원본 보호 헤더 값(x-qn-origin-verify)",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${props.envPrefix}quicknote MCP server`,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      // 한국 엣지 포함(PriceClass_100 은 북미·유럽만).
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        // unsafeUnwrap 은 평문이 아니라 {{resolve:secretsmanager:…}} 동적 참조를 만든다(CloudFront 가 배포 시 해석).
        origin: new origins.FunctionUrlOrigin(props.fnUrl, {
          customHeaders: { [ORIGIN_VERIFY_HEADER]: secret.secretValue.unsafeUnwrap() },
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: false,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: edgeFunction(this, "ViewerRequestFn", "viewer-request.js") },
          { eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE, function: edgeFunction(this, "ViewerResponseFn", "viewer-response.js") },
        ],
      },
    });
    this.publicOrigin = `https://${distribution.distributionDomainName}`;

    const paramName = mcpPublicOriginParamName(props.envPrefix);
    new ssm.StringParameter(this, "PublicOriginParam", { parameterName: paramName, stringValue: this.publicOrigin });
    props.fn.addEnvironment("ORIGIN_VERIFY_SECRET_ID", secretName);
    props.fn.addEnvironment("MCP_PUBLIC_ORIGIN_PARAM", paramName);
    props.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [stack.formatArn({ service: "ssm", resource: "parameter", resourceName: paramName.slice(1) })],
      }),
    );
    // 그 비밀의 GetSecretValue 만(비밀은 다른 리소스를 참조하지 않아 정책 → 비밀 참조로 순환이 생기지 않는다).
    props.fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [secret.secretArn] }),
    );

    new cdk.CfnOutput(stack, "McpServerUrl", { value: `${this.publicOrigin}/mcp` });
    new cdk.CfnOutput(stack, "McpServerOriginUrl", { value: `${props.fnUrl.url}mcp` });
  }
}
