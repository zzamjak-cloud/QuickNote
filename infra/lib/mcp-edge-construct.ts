// MCP 서버 앞단 CloudFront — 공개 origin 을 CloudFront 로 고정하고 원본(Function URL)을 보호한다.
//
// WWW-Authenticate 복원: Function URL 은 응답의 WWW-Authenticate 를 x-amzn-Remapped-WWW-Authenticate 로 바꾼다.
// viewer-response 함수는 원본이 400 이상을 돌려주면 실행되지 않아(AWS 제약, dev 실측) 401 에서 쓸 수 없다.
// 대신 `/mcp` 동작에 응답 헤더 정책(모든 응답에 적용)으로 WWW-Authenticate 를 붙이고 리매핑 헤더를 지운다.
// 헤더 값의 resource_metadata 는 절대 URL 이라 배포 도메인이 필요한데, 정책 → 배포 도메인 → 배포 → 정책 순환이 되므로
// 이미 배포된 도메인을 설정값(publicOriginHint)으로 받는다(신규 환경은 첫 배포 후 설정 → 재배포, 그 전엔 well-known 폴백).
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

/**
 * 이미 배포된 MCP CloudFront 공개 origin(env 별). 배포 도메인은 배포 수명 동안 고정이다.
 * 우선순위: env MCP_PUBLIC_ORIGIN > `-c mcpPublicOrigin=` > 이 표. live 는 첫 배포 후 채운다.
 */
export const KNOWN_MCP_PUBLIC_ORIGINS: Record<string, string> = {
  "dev-": "https://dbeovncdo410b.cloudfront.net",
};

const CLOUDFRONT_ORIGIN_RE = /^https:\/\/[a-z0-9]+\.cloudfront\.net$/;

/** MCP 401 의 WWW-Authenticate(Lambda index.ts 의 challenge 와 같은 형식, error 파라미터 제외). */
export function mcpAuthChallenge(publicOrigin: string): string {
  return `Bearer realm="quicknote", resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource/mcp"`;
}

export interface McpEdgeProps {
  envPrefix: string;
  fn: lambda.Function;
  fnUrl: lambda.FunctionUrl;
  /** 이미 배포된 이 배포의 공개 origin(https://xxxx.cloudfront.net). 있으면 `/mcp` 에 WWW-Authenticate 응답 헤더 정책을 붙인다. */
  publicOriginHint?: string;
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

    const behavior: cloudfront.BehaviorOptions = {
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
      ],
    };
    const hint = props.publicOriginHint;
    if (hint !== undefined && !CLOUDFRONT_ORIGIN_RE.test(hint)) {
      throw new Error(`publicOriginHint must look like https://xxxx.cloudfront.net (got ${hint})`);
    }
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${props.envPrefix}quicknote MCP server`,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      // 한국 엣지 포함(PriceClass_100 은 북미·유럽만).
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: behavior,
      additionalBehaviors: hint ? { "/mcp": { ...behavior, responseHeadersPolicy: this.challengePolicy(props.envPrefix, hint) } } : {},
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
    // 힌트가 실제 배포 도메인과 같은지 배포 후 확인용(다르면 resource_metadata 가 엉뚱한 곳을 가리킨다).
    new cdk.CfnOutput(stack, "McpPublicOriginHint", { value: hint ?? "(none — well-known fallback only)" });
    new cdk.CfnOutput(stack, "McpServerOriginUrl", { value: `${props.fnUrl.url}mcp` });
  }

  /**
   * `/mcp` 응답 헤더 정책 — 문서상 "CloudFront adds these headers to every response that it returns to viewers"(4xx 포함).
   * override=false: 원본이 WWW-Authenticate 를 직접 보내면 그 값을 쓴다. 리매핑 헤더는 지운다.
   * 200 응답에도 붙지만 MCP 클라이언트는 401 에서만 해석한다.
   */
  private challengePolicy(envPrefix: string, publicOrigin: string): cloudfront.ResponseHeadersPolicy {
    return new cloudfront.ResponseHeadersPolicy(this, "McpChallengeHeaders", {
      responseHeadersPolicyName: `${envPrefix}quicknote-mcp-challenge`,
      comment: "MCP 401 WWW-Authenticate 복원(Function URL 리매핑 대응)",
      customHeadersBehavior: {
        customHeaders: [{ header: "WWW-Authenticate", value: mcpAuthChallenge(publicOrigin), override: false }],
      },
      removeHeaders: ["x-amzn-remapped-www-authenticate"],
    });
  }
}
