// MCP OAuth 2.1 파사드 리소스 — McpServerFn(공개 origin = CloudFront, mcp-edge-construct.ts)에 붙는 테이블·Cognito 앱 클라이언트·권한.
// sync-stack.ts 변경을 최소화하려고 별도 construct 로 둔다.
//
// 순환 참조 회피: Cognito 앱 클라이언트 callback 은 CloudFront 도메인을 참조하고, 배포는 Function URL → 함수를 참조한다.
// 함수 env 가 클라이언트 ID 를 참조하면 순환이므로, 클라이언트 ID 는 SSM 파라미터로 게시하고 런타임에 읽는다.
// (클라이언트는 CognitoStack 이 아니라 여기서 만든다 — CognitoStack 은 SyncStack 보다 먼저 배포돼 CloudFront 도메인을 알 수 없다.)
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { DYNAMODB_TABLE_ENCRYPTION } from "./sync/table-encryption";

export interface McpOAuthProps {
  envPrefix: string;
  fn: lambda.Function;
  /** 공개 origin(CloudFront, 끝 슬래시 없음) — issuer·resource·Cognito callback 의 기준. */
  publicOrigin: string;
  userPool: cognito.IUserPool;
  userPoolId: string;
  /** CognitoStack 의 Hosted UI 도메인 접두사(<prefix>.auth.<region>.amazoncognito.com). */
  cognitoDomainPrefix: string;
  /** PAT 테이블 — OAuth access token(oat#)·grant family(oauth-family#) 항목을 함께 둔다. */
  mcpTokensTable: dynamodb.Table;
  /** ai-usage 테이블 — IP 단위 상한 카운터(pk=mcp-oa#…). */
  rateLimitTable: dynamodb.Table;
}

export function mcpOAuthClientIdParamName(envPrefix: string): string {
  return `/${envPrefix}quicknote/mcp-oauth-cognito-client-id`;
}

export class McpOAuth extends Construct {
  constructor(scope: Construct, id: string, props: McpOAuthProps) {
    super(scope, id);
    const { envPrefix, fn } = props;
    const stack = cdk.Stack.of(this);

    const clientsTable = new dynamodb.Table(this, "ClientsTable", {
      tableName: `${envPrefix}quicknote-mcp-oauth-clients`,
      partitionKey: { name: "clientId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 재등록 가능한 단명 데이터
    });
    // tx#(10분)·code#(60초)·rt#(refresh, grant 만료까지) — 모두 TTL 로 정리.
    const grantsTable = new dynamodb.Table(this, "GrantsTable", {
      tableName: `${envPrefix}quicknote-mcp-oauth-grants`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 1시간짜리 access token 항목이 쌓이지 않게 mcp-tokens 에 TTL(ttl) 을 켠다. PAT 항목은 ttl 이 없어 영향 없음.
    const tokensCfn = props.mcpTokensTable.node.defaultChild as dynamodb.CfnTable;
    tokensCfn.timeToLiveSpecification = { attributeName: "ttl", enabled: true };

    const callbackUrl = `${props.publicOrigin}/callback`;
    const appClient = new cognito.UserPoolClient(this, "CognitoClient", {
      userPool: props.userPool,
      userPoolClientName: `${envPrefix}quicknote-mcp-oauth`,
      generateSecret: false, // 서버 측 교환이지만 PKCE public 클라이언트로 둔다(비밀 보관 불필요).
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false, clientCredentials: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [callbackUrl],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.GOOGLE],
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.minutes(5),
      accessTokenValidity: cdk.Duration.minutes(5),
      refreshTokenValidity: cdk.Duration.minutes(60),
    });
    // 도메인이 managed login(v2)이라 CFN 으로 만든 클라이언트는 스타일이 있어야 한다(Cognito 기본 스타일).
    new cognito.CfnManagedLoginBranding(this, "CognitoClientBranding", {
      userPoolId: props.userPoolId,
      clientId: appClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    new ssm.StringParameter(this, "CognitoClientIdParam", {
      parameterName: mcpOAuthClientIdParamName(envPrefix),
      stringValue: appClient.userPoolClientId,
    });

    fn.addEnvironment("OAUTH_CLIENTS_TABLE_NAME", clientsTable.tableName);
    fn.addEnvironment("OAUTH_GRANTS_TABLE_NAME", grantsTable.tableName);
    fn.addEnvironment("OAUTH_COGNITO_DOMAIN", `https://${props.cognitoDomainPrefix}.auth.${stack.region}.amazoncognito.com`);
    fn.addEnvironment("OAUTH_USER_POOL_ID", props.userPoolId);
    fn.addEnvironment("OAUTH_COGNITO_CLIENT_ID_PARAM", mcpOAuthClientIdParamName(envPrefix));

    clientsTable.grantReadWriteData(fn);
    grantsTable.grantReadWriteData(fn);
    // mcp-tokens: OAuth 항목(oat#·oauth-family#)만 생성, family 만 폐기 갱신 — PAT 항목은 기존 정책대로 lastUsedAt 만.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [props.mcpTokensTable.tableArn],
        conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["oat#*", "oauth-family#*"] } },
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [props.mcpTokensTable.tableArn],
        conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["oauth-family#*"] } },
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [props.rateLimitTable.tableArn],
        conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["mcp-oa#*"] } },
      }),
    );
    // 파라미터 ARN 은 이름으로 구성한다(파라미터 리소스를 참조하면 함수 → 정책 → 파라미터 → 클라이언트 → URL → 함수 순환).
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          stack.formatArn({
            service: "ssm",
            resource: "parameter",
            resourceName: mcpOAuthClientIdParamName(envPrefix).slice(1),
          }),
        ],
      }),
    );

    new cdk.CfnOutput(stack, "McpOAuthIssuer", { value: props.publicOrigin });
    new cdk.CfnOutput(stack, "McpOAuthCognitoCallbackUrl", { value: callbackUrl });
  }
}
