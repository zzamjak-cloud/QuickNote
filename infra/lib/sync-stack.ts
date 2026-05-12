import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import { createSyncTable, type ModelTable } from "./sync/ddb-table-factory";

export interface SyncStackProps extends cdk.StackProps {
  // CognitoStack 의 출력값을 cross-stack reference 로 받는다.
  userPoolId: string;
  userPoolArn: string;
  imagesBucketName: string;
  membersTableName?: string;
  teamsTableName?: string;
  memberTeamsTableName?: string;
  workspacesTableName?: string;
  workspaceAccessTableName?: string;
}

export class QuicknoteSyncStack extends cdk.Stack {
  public readonly pageTable: ModelTable;
  public readonly databaseTable: ModelTable;
  public readonly imageAssetTable: ModelTable;
  public readonly commentTable: ModelTable;
  public readonly imagesBucket: s3.Bucket;
  public readonly api: appsync.GraphqlApi;
  public readonly membersTable: dynamodb.Table;
  public readonly teamsTable: dynamodb.Table;
  public readonly memberTeamsTable: dynamodb.Table;
  public readonly workspacesTable: dynamodb.Table;
  public readonly workspaceAccessTable: dynamodb.Table;

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
    this.commentTable = createSyncTable(this, "CommentTable", "Comment");
    this.imageAssetTable = createSyncTable(this, "ImageAssetTable", "ImageAsset", {
      ttlAttribute: "expireAt", // pending 1일 자동 삭제용
    });

    // v5: workspaceId 스코핑 조회용 GSI. 기존 byOwner GSI 는 마이그레이션 완료 후 제거.
    this.pageTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.databaseTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.commentTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, "PageTableName", { value: this.pageTable.table.tableName });
    new cdk.CfnOutput(this, "DatabaseTableName", { value: this.databaseTable.table.tableName });
    new cdk.CfnOutput(this, "CommentTableName", { value: this.commentTable.table.tableName });
    new cdk.CfnOutput(this, "ImageAssetTableName", {
      value: this.imageAssetTable.table.tableName,
    });

    // v5 신규 테이블 5종 — workspace 기반 멀티 유저 협업 인프라
    const membersTable = new dynamodb.Table(this, "MembersTable", {
      tableName: props.membersTableName ?? "quicknote-members",
      partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    membersTable.addGlobalSecondaryIndex({
      indexName: "byEmail",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    membersTable.addGlobalSecondaryIndex({
      indexName: "byCognitoSub",
      partitionKey: { name: "cognitoSub", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const teamsTable = new dynamodb.Table(this, "TeamsTable", {
      tableName: props.teamsTableName ?? "quicknote-teams",
      partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const memberTeamsTable = new dynamodb.Table(this, "MemberTeamsTable", {
      tableName: props.memberTeamsTableName ?? "quicknote-member-teams",
      partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    memberTeamsTable.addGlobalSecondaryIndex({
      indexName: "byTeam",
      partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const workspacesTable = new dynamodb.Table(this, "WorkspacesTable", {
      tableName: props.workspacesTableName ?? "quicknote-workspaces",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    workspacesTable.addGlobalSecondaryIndex({
      indexName: "byOwnerAndType",
      partitionKey: { name: "ownerMemberId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "type", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const workspaceAccessTable = new dynamodb.Table(this, "WorkspaceAccessTable", {
      tableName: props.workspaceAccessTableName ?? "quicknote-workspace-access",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "subjectKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    workspaceAccessTable.addGlobalSecondaryIndex({
      indexName: "bySubject",
      partitionKey: { name: "subjectKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, "MembersTableName", { value: membersTable.tableName });
    new cdk.CfnOutput(this, "TeamsTableName", { value: teamsTable.tableName });
    new cdk.CfnOutput(this, "MemberTeamsTableName", { value: memberTeamsTable.tableName });
    new cdk.CfnOutput(this, "WorkspacesTableName", { value: workspacesTable.tableName });
    new cdk.CfnOutput(this, "WorkspaceAccessTableName", { value: workspaceAccessTable.tableName });

    this.membersTable = membersTable;
    this.teamsTable = teamsTable;
    this.memberTeamsTable = memberTeamsTable;
    this.workspacesTable = workspacesTable;
    this.workspaceAccessTable = workspaceAccessTable;

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
            // ALLOW: 인증된 사용자는 기본 접근 허용. 필드별 소유권 검증은
            // DynamoDB 리졸버의 condition expression(owner = $ctx.identity.sub)에서
            // 처리한다. DENY 로 두면 스키마 모든 필드에 @aws_cognito_user_pools
            // 디렉티브를 붙여야 하는데 본 앱은 그룹 기반 권한을 안 쓴다.
            defaultAction: appsync.UserPoolDefaultAction.ALLOW,
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

    // 야간 image GC Lambda — 30일 미참조 이미지 정리.
    const gcFn = new lambdaNode.NodejsFunction(this, "ImageGcFn", {
      entry: path.join(__dirname, "..", "lambda", "image-gc", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        PAGE_TABLE: this.pageTable.table.tableName,
        IMAGE_ASSET_TABLE: this.imageAssetTable.table.tableName,
        IMAGES_BUCKET: imagesBucket.bucketName,
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });

    this.pageTable.table.grantReadData(gcFn);
    this.imageAssetTable.table.grantReadWriteData(gcFn);
    imagesBucket.grantDelete(gcFn);

    new events.Rule(this, "ImageGcSchedule", {
      // UTC 18:00 = KST 03:00
      schedule: events.Schedule.cron({ minute: "0", hour: "18" }),
      targets: [new eventsTargets.LambdaFunction(gcFn)],
    });

    // 휴지통 보관(30일) 만료 페이지 — DynamoDB 에서 영구 삭제
    const trashPurgeFn = new lambdaNode.NodejsFunction(this, "TrashPurgeFn", {
      entry: path.join(__dirname, "..", "lambda", "trash-purge", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.minutes(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        PAGES_TABLE_NAME: this.pageTable.table.tableName,
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });
    this.pageTable.table.grantReadWriteData(trashPurgeFn);
    new events.Rule(this, "TrashPurgeSchedule", {
      schedule: events.Schedule.cron({ minute: "15", hour: "18" }),
      targets: [new eventsTargets.LambdaFunction(trashPurgeFn)],
    });
    new cdk.CfnOutput(this, "TrashPurgeFunctionName", {
      value: trashPurgeFn.functionName,
    });

    // v5-resolvers Lambda — 모든 v5 admin/workspace mutation/query 라우터
    const v5ResolversFn = new lambdaNode.NodejsFunction(this, "V5ResolversFn", {
      entry: path.join(__dirname, "..", "lambda", "v5-resolvers", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        MEMBERS_TABLE_NAME: this.membersTable.tableName,
        TEAMS_TABLE_NAME: this.teamsTable.tableName,
        MEMBER_TEAMS_TABLE_NAME: this.memberTeamsTable.tableName,
        WORKSPACES_TABLE_NAME: this.workspacesTable.tableName,
        WORKSPACE_ACCESS_TABLE_NAME: this.workspaceAccessTable.tableName,
        PAGES_TABLE_NAME: this.pageTable.table.tableName,
        DATABASES_TABLE_NAME: this.databaseTable.table.tableName,
        COMMENTS_TABLE_NAME: this.commentTable.table.tableName,
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // 5개 테이블 read/write 권한
    this.membersTable.grantReadWriteData(v5ResolversFn);
    this.teamsTable.grantReadWriteData(v5ResolversFn);
    this.memberTeamsTable.grantReadWriteData(v5ResolversFn);
    this.workspacesTable.grantReadWriteData(v5ResolversFn);
    this.workspaceAccessTable.grantReadWriteData(v5ResolversFn);
    this.pageTable.table.grantReadWriteData(v5ResolversFn);
    this.databaseTable.table.grantReadWriteData(v5ResolversFn);
    this.commentTable.table.grantReadWriteData(v5ResolversFn);

    // AppSync Lambda DataSource
    const v5Ds = api.addLambdaDataSource("V5ResolversDs", v5ResolversFn);

    // 본 task 범위: me, createMember, listMembers, getMember 만 wiring.
    // 후속 task 들이 같은 Ds 에 mutation/query 추가.
    v5Ds.createResolver("MeQuery", {
      typeName: "Query", fieldName: "me",
    });
    v5Ds.createResolver("CreateMemberMutation", {
      typeName: "Mutation", fieldName: "createMember",
    });
    v5Ds.createResolver("ListMembersQuery", {
      typeName: "Query", fieldName: "listMembers",
    });
    v5Ds.createResolver("GetMemberQuery", {
      typeName: "Query", fieldName: "getMember",
    });
    v5Ds.createResolver("UpdateMemberMutation", { typeName: "Mutation", fieldName: "updateMember" });
    v5Ds.createResolver("UpdateMyClientPrefsMutation", {
      typeName: "Mutation",
      fieldName: "updateMyClientPrefs",
    });
    v5Ds.createResolver("PromoteToManagerMutation", { typeName: "Mutation", fieldName: "promoteToManager" });
    v5Ds.createResolver("DemoteToMemberMutation", { typeName: "Mutation", fieldName: "demoteToMember" });
    v5Ds.createResolver("TransferOwnershipMutation", { typeName: "Mutation", fieldName: "transferOwnership" });
    v5Ds.createResolver("RemoveMemberMutation", { typeName: "Mutation", fieldName: "removeMember" });
    v5Ds.createResolver("RestoreMemberMutation", { typeName: "Mutation", fieldName: "restoreMember" });
    v5Ds.createResolver("PermanentDeleteMemberMutation", { typeName: "Mutation", fieldName: "permanentDeleteMember" });
    v5Ds.createResolver("AssignMemberToTeamMutation", { typeName: "Mutation", fieldName: "assignMemberToTeam" });
    v5Ds.createResolver("UnassignMemberFromTeamMutation", { typeName: "Mutation", fieldName: "unassignMemberFromTeam" });
    v5Ds.createResolver("ListTeamsQuery", { typeName: "Query", fieldName: "listTeams" });
    v5Ds.createResolver("GetTeamQuery", { typeName: "Query", fieldName: "getTeam" });
    v5Ds.createResolver("CreateTeamMutation", { typeName: "Mutation", fieldName: "createTeam" });
    v5Ds.createResolver("UpdateTeamMutation", { typeName: "Mutation", fieldName: "updateTeam" });
    v5Ds.createResolver("DeleteTeamMutation", { typeName: "Mutation", fieldName: "deleteTeam" });
    v5Ds.createResolver("CreateWorkspaceMutation", { typeName: "Mutation", fieldName: "createWorkspace" });
    v5Ds.createResolver("UpdateWorkspaceMutation", { typeName: "Mutation", fieldName: "updateWorkspace" });
    v5Ds.createResolver("SetWorkspaceAccessMutation", { typeName: "Mutation", fieldName: "setWorkspaceAccess" });
    v5Ds.createResolver("DeleteWorkspaceMutation", { typeName: "Mutation", fieldName: "deleteWorkspace" });
    v5Ds.createResolver("ListMyWorkspacesQuery", { typeName: "Query", fieldName: "listMyWorkspaces" });
    v5Ds.createResolver("GetWorkspaceQuery", { typeName: "Query", fieldName: "getWorkspace" });
    v5Ds.createResolver("SearchMembersForMentionQuery", { typeName: "Query", fieldName: "searchMembersForMention" });
    // 기존 배포의 Logical ID를 강제로 유지해 Resolver 교체 시 AlreadyExists를 피한다.
    const listPagesResolver = v5Ds.createResolver("QuerylistPages", {
      typeName: "Query",
      fieldName: "listPages",
    });
    (listPagesResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiQuerylistPagesB67FE9DA");

    const listDatabasesResolver = v5Ds.createResolver("QuerylistDatabases", {
      typeName: "Query",
      fieldName: "listDatabases",
    });
    (listDatabasesResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiQuerylistDatabasesC5178196");

    v5Ds.createResolver("QuerylistTrashedPages", {
      typeName: "Query",
      fieldName: "listTrashedPages",
    });

    const upsertPageResolver = v5Ds.createResolver("MutationupsertPage", {
      typeName: "Mutation",
      fieldName: "upsertPage",
    });
    (upsertPageResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiMutationupsertPage70CE2413");

    const softDeletePageResolver = v5Ds.createResolver("MutationsoftDeletePage", {
      typeName: "Mutation",
      fieldName: "softDeletePage",
    });
    (softDeletePageResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiMutationsoftDeletePage005AAFF7");

    v5Ds.createResolver("QuerylistComments", {
      typeName: "Query",
      fieldName: "listComments",
    });
    v5Ds.createResolver("MutationupsertComment", {
      typeName: "Mutation",
      fieldName: "upsertComment",
    });
    v5Ds.createResolver("MutationsoftDeleteComment", {
      typeName: "Mutation",
      fieldName: "softDeleteComment",
    });
    v5Ds.createResolver("SubscriptiononCommentChanged", {
      typeName: "Subscription",
      fieldName: "onCommentChanged",
    });

    v5Ds.createResolver("MutationrestorePage", {
      typeName: "Mutation",
      fieldName: "restorePage",
    });

    const upsertDatabaseResolver = v5Ds.createResolver("MutationupsertDatabase", {
      typeName: "Mutation",
      fieldName: "upsertDatabase",
    });
    (upsertDatabaseResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiMutationupsertDatabase432CF126");

    const softDeleteDatabaseResolver = v5Ds.createResolver("MutationsoftDeleteDatabase", {
      typeName: "Mutation",
      fieldName: "softDeleteDatabase",
    });
    (softDeleteDatabaseResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiMutationsoftDeleteDatabase0827D9EA");

    const onPageChangedResolver = v5Ds.createResolver("SubscriptiononPageChanged", {
      typeName: "Subscription",
      fieldName: "onPageChanged",
    });
    (onPageChangedResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiSubscriptiononPageChangedC0926FB3");

    const onDatabaseChangedResolver = v5Ds.createResolver("SubscriptiononDatabaseChanged", {
      typeName: "Subscription",
      fieldName: "onDatabaseChanged",
    });
    (onDatabaseChangedResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiSubscriptiononDatabaseChangedE8BD5823");

    // v5 데이터 마이그레이션 Lambda (v4 ownerId -> v5 workspace/member 필드 보강)
    const v5MigrationFn = new lambdaNode.NodejsFunction(this, "V5MigrationFn", {
      entry: path.join(__dirname, "..", "lambda", "v5-migration", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        MEMBERS_TABLE_NAME: this.membersTable.tableName,
        WORKSPACES_TABLE_NAME: this.workspacesTable.tableName,
        WORKSPACE_ACCESS_TABLE_NAME: this.workspaceAccessTable.tableName,
        PAGES_TABLE_NAME: this.pageTable.table.tableName,
        DATABASES_TABLE_NAME: this.databaseTable.table.tableName,
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });
    this.membersTable.grantReadWriteData(v5MigrationFn);
    this.workspacesTable.grantReadWriteData(v5MigrationFn);
    this.workspaceAccessTable.grantReadWriteData(v5MigrationFn);
    this.pageTable.table.grantReadWriteData(v5MigrationFn);
    this.databaseTable.table.grantReadWriteData(v5MigrationFn);
    new cdk.CfnOutput(this, "V5MigrationFunctionName", { value: v5MigrationFn.functionName });
  }
}
