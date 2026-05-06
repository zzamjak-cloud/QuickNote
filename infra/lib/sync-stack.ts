import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { createSyncTable, type ModelTable } from "./sync/ddb-table-factory";
import { attachOwnerScopedModelResolvers } from "./sync/appsync-resolver-factory";

export interface SyncStackProps extends cdk.StackProps {
  // CognitoStack 의 출력값을 cross-stack reference 로 받는다.
  userPoolId: string;
  userPoolArn: string;
  imagesBucketName: string;
}

export class QuicknoteSyncStack extends cdk.Stack {
  public readonly pageTable: ModelTable;
  public readonly databaseTable: ModelTable;
  public readonly contactTable: ModelTable;
  public readonly imageAssetTable: ModelTable;
  public readonly imagesBucket: s3.Bucket;
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: SyncStackProps) {
    super(scope, id, props);

    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      "ImportedUserPool",
      props.userPoolArn,
    );

    // 4개 owner-scoped 테이블을 팩토리로 생성.
    this.pageTable = createSyncTable(this, "PageTable", "Page");
    this.databaseTable = createSyncTable(this, "DatabaseTable", "Database");
    this.contactTable = createSyncTable(this, "ContactTable", "Contact");
    this.imageAssetTable = createSyncTable(this, "ImageAssetTable", "ImageAsset", {
      ttlAttribute: "expireAt", // pending 1일 자동 삭제용
    });

    new cdk.CfnOutput(this, "PageTableName", { value: this.pageTable.table.tableName });
    new cdk.CfnOutput(this, "DatabaseTableName", { value: this.databaseTable.table.tableName });
    new cdk.CfnOutput(this, "ContactTableName", { value: this.contactTable.table.tableName });
    new cdk.CfnOutput(this, "ImageAssetTableName", {
      value: this.imageAssetTable.table.tableName,
    });

    // 이미지 업로드용 S3 버킷. PreSignedURL 만 유효해 사실상 안전.
    const imagesBucket = new s3.Bucket(this, "ImagesBucket", {
      bucketName: props.imagesBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"], // PreSignedURL 만 유효해 사실상 안전
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "expire-pending-uploads",
          enabled: true,
          prefix: "users/",
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          expiration: undefined, // 정상 객체는 만료시키지 않음
        },
      ],
    });

    this.imagesBucket = imagesBucket;
    new cdk.CfnOutput(this, "ImagesBucketName", { value: imagesBucket.bucketName });

    // AppSync GraphQL API. Cognito User Pool 을 primary authorizer 로 사용한다.
    const api = new appsync.GraphqlApi(this, "SyncApi", {
      name: "quicknote-sync",
      definition: appsync.Definition.fromFile(
        path.join(__dirname, "sync", "schema.graphql"),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool,
            defaultAction: appsync.UserPoolDefaultAction.DENY,
          },
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
        retention: logs.RetentionDays.ONE_MONTH,
      },
      xrayEnabled: false,
    });

    this.api = api;

    new cdk.CfnOutput(this, "AppSyncEndpoint", { value: api.graphqlUrl });
    new cdk.CfnOutput(this, "AppSyncApiId", { value: api.apiId });
    // realtime URL 은 endpoint 에서 ".appsync-api." → ".appsync-realtime-api." 로 도출.
    // Amplify GraphQL 클라이언트가 자동 처리하므로 별도 출력은 생략.

    // 3 owner-scoped 모델에 LWW 리졸버 부착.
    attachOwnerScopedModelResolvers(api, "Page", this.pageTable);
    attachOwnerScopedModelResolvers(api, "Database", this.databaseTable);
    attachOwnerScopedModelResolvers(api, "Contact", this.contactTable);

    // 이미지 PreSignedURL 발급·검증 Lambda. AppSync 가 invoke.
    const presignFn = new lambdaNode.NodejsFunction(this, "ImagePresignFn", {
      entry: path.join(__dirname, "..", "lambda", "image-presign", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGE_ASSET_TABLE: this.imageAssetTable.table.tableName,
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });

    imagesBucket.grantPut(presignFn);
    imagesBucket.grantRead(presignFn);
    this.imageAssetTable.table.grantReadWriteData(presignFn);

    const presignDs = api.addLambdaDataSource("ImagePresignDs", presignFn);

    // AppSync JS 리졸버 inline passthrough — Lambda 가 단일 핸들러로 분기 처리.
    const passthroughCode = appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: "Invoke",
    payload: { info: ctx.info, identity: ctx.identity, arguments: ctx.arguments },
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
`);

    const jsRuntime = appsync.FunctionRuntime.JS_1_0_0;

    presignDs.createResolver("Mutation_getImageUploadUrl", {
      typeName: "Mutation",
      fieldName: "getImageUploadUrl",
      runtime: jsRuntime,
      code: passthroughCode,
    });
    presignDs.createResolver("Mutation_confirmImage", {
      typeName: "Mutation",
      fieldName: "confirmImage",
      runtime: jsRuntime,
      code: passthroughCode,
    });
    presignDs.createResolver("Query_getImageDownloadUrl", {
      typeName: "Query",
      fieldName: "getImageDownloadUrl",
      runtime: jsRuntime,
      code: passthroughCode,
    });
  }
}
