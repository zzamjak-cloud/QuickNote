import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
// WebSocket L2 구문은 aws-cdk-lib 2.252 의 stable 패키지에 포함되어 있다.
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integ from "aws-cdk-lib/aws-apigatewayv2-integrations";

export interface RealtimeCollabStackProps extends cdk.StackProps {
  /** 리소스 이름 접두사. dev 환경은 "dev-", live 환경은 "" */
  envPrefix: string;
  // CognitoStack / SyncStack 의 출력값을 cross-stack reference 로 받는다.
  userPoolId: string;
  userPoolClientId: string;
  pageTableName: string;
  pageTableArn: string;
}

/**
 * 실시간 협업 백엔드 스택.
 * API Gateway WebSocket API + 3개 DynamoDB 테이블 + 3개 Lambda 핸들러를 프로비저닝한다.
 *   - connections: WS 연결 추적(byPageId GSI, ttl 자동 만료)
 *   - ydoc: Yjs 문서 스냅샷
 *   - ydocUpdates: Yjs 증분 업데이트(seq 정렬키)
 */
export class QuicknoteRealtimeCollabStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RealtimeCollabStackProps) {
    super(scope, id, props);

    const envPrefix = props.envPrefix;

    // WS 연결 추적 테이블. ttl 속성으로 좀비 연결을 자동 만료한다.
    const connections = new dynamodb.Table(this, "RtConnections", {
      tableName: `${envPrefix}quicknote-rt-connections`,
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // 페이지별 연결 목록 조회용 GSI (브로드캐스트 fan-out).
    connections.addGlobalSecondaryIndex({
      indexName: "byPageId",
      partitionKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // Yjs 문서 스냅샷 테이블.
    const ydoc = new dynamodb.Table(this, "YDoc", {
      tableName: `${envPrefix}quicknote-rt-ydoc`,
      partitionKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Yjs 증분 업데이트 테이블. seq(정렬키)로 순차 적용한다.
    const ydocUpdates = new dynamodb.Table(this, "YDocUpdates", {
      tableName: `${envPrefix}quicknote-rt-ydoc-updates`,
      partitionKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "seq", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 모든 핸들러에 공통 주입하는 환경변수.
    const environment = {
      CONNECTIONS_TABLE: connections.tableName,
      YDOC_TABLE: ydoc.tableName,
      YDOC_UPDATES_TABLE: ydocUpdates.tableName,
      PAGE_TABLE: props.pageTableName,
      USER_POOL_ID: props.userPoolId,
      USER_POOL_CLIENT_ID: props.userPoolClientId,
    };

    // realtime 핸들러 Lambda 팩토리.
    const makeFn = (name: string, entry: string) =>
      new nodejs.NodejsFunction(this, name, {
        entry: path.join(__dirname, "..", "lambda", "realtime", entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment,
        bundling: {
          format: nodejs.OutputFormat.ESM,
          target: "node20",
          externalModules: ["@aws-sdk/*"],
        },
      });

    const connectFn = makeFn("ConnectFn", "connect.ts");
    const disconnectFn = makeFn("DisconnectFn", "disconnect.ts");
    const syncFn = makeFn("SyncFn", "sync.ts");

    // 권한 부여: 모든 핸들러는 연결 테이블 읽기/쓰기. sync 만 Yjs 테이블 접근.
    [connectFn, disconnectFn, syncFn].forEach((f) => connections.grantReadWriteData(f));
    ydoc.grantReadWriteData(syncFn);
    ydocUpdates.grantReadWriteData(syncFn);
    // connect 핸들러는 페이지 존재/워크스페이스 귀속 확인을 위해 Pages 테이블 GetItem 만 필요.
    connectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem"],
        resources: [props.pageTableArn],
      }),
    );

    // WebSocket API — $connect/$disconnect 는 라우트 옵션, sync 는 커스텀 라우트.
    const api = new apigw.WebSocketApi(this, "CollabWsApi", {
      apiName: `${envPrefix}quicknote-rt-collab`,
      connectRouteOptions: {
        integration: new integ.WebSocketLambdaIntegration("ConnectInteg", connectFn),
      },
      disconnectRouteOptions: {
        integration: new integ.WebSocketLambdaIntegration("DisconnectInteg", disconnectFn),
      },
    });
    api.addRoute("sync", {
      integration: new integ.WebSocketLambdaIntegration("SyncInteg", syncFn),
    });

    const stage = new apigw.WebSocketStage(this, "CollabWsStage", {
      webSocketApi: api,
      stageName: "prod",
      autoDeploy: true,
    });

    // sync 핸들러가 @connections API 로 클라이언트에 메시지를 push 할 수 있도록 허용.
    api.grantManageConnections(syncFn);

    new cdk.CfnOutput(this, "CollabWsUrl", { value: stage.url });
  }
}
