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
import { DYNAMODB_TABLE_ENCRYPTION } from "./sync/table-encryption";

// DynamoDB 는 한 번의 업데이트에 GSI 를 하나만 생성/삭제할 수 있다.
// 그래서 Pages 테이블 GSI 는 누적 단계로 하나씩 추가한다(아래 순서대로 cdk deploy 반복).
//   meta → all(byDatabaseAndOrder) → scope-org → scope-team → scope-project
const PAGE_TABLE_GSI_STAGES = [
  "meta",
  "all",
  "scope-org",
  "scope-team",
  "scope-project",
] as const;
type PageTableGsiDeployStage = (typeof PAGE_TABLE_GSI_STAGES)[number];

function resolvePageTableGsiDeployStage(scope: Construct): PageTableGsiDeployStage {
  // 기본값은 최종 단계. 신규 GSI 를 단계 배포할 때만 -c pageTableGsiDeployStage=scope-org 등으로 지정.
  const rawStage = scope.node.tryGetContext("pageTableGsiDeployStage") ?? "scope-project";
  if ((PAGE_TABLE_GSI_STAGES as readonly string[]).includes(rawStage)) {
    return rawStage as PageTableGsiDeployStage;
  }
  throw new Error(
    `pageTableGsiDeployStage 는 ${PAGE_TABLE_GSI_STAGES.join(" | ")} 중 하나여야 합니다.`,
  );
}

/** 현재 단계가 target 단계 이상인지(누적 게이팅). */
function pageTableGsiStageAtLeast(
  stage: PageTableGsiDeployStage,
  target: PageTableGsiDeployStage,
): boolean {
  return PAGE_TABLE_GSI_STAGES.indexOf(stage) >= PAGE_TABLE_GSI_STAGES.indexOf(target);
}

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
  /** 조직(실) 테이블 이름 (기본값: quicknote-organizations) */
  organizationsTableName?: string;
  /** 멤버-조직 관계 테이블 이름 (기본값: quicknote-member-organizations) */
  memberOrganizationsTableName?: string;
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
  public readonly organizationsTable: dynamodb.Table;
  public readonly memberOrganizationsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: SyncStackProps) {
    super(scope, id, props);

    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      "ImportedUserPool",
      props.userPoolArn,
    );

    // 4개 owner-scoped 테이블을 팩토리로 생성.
    // Page 는 휴지통 만료 자동 삭제용 TTL 속성(purgeAt, epoch seconds)을 둔다(#1).
    // soft delete 시 purgeAt = deletedAt + 30일 을 기록하고, 복원 시 제거한다.
    // DynamoDB TTL 삭제는 WCU 과금이 없어 trash-purge 일일 풀스캔/삭제를 대체한다.
    this.pageTable = createSyncTable(this, "PageTable", "Page", {
      ttlAttribute: "purgeAt",
    });
    this.databaseTable = createSyncTable(this, "DatabaseTable", "Database");
    this.commentTable = createSyncTable(this, "CommentTable", "Comment");
    this.imageAssetTable = createSyncTable(this, "ImageAssetTable", "ImageAsset", {
      ttlAttribute: "expireAt", // pending 1일 자동 삭제용
    });
    const pageTableGsiDeployStage = resolvePageTableGsiDeployStage(this);

    // v5: workspaceId 스코핑 조회용 GSI. 기존 byOwner GSI 는 마이그레이션 완료 후 제거.
    this.pageTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.pageTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceMetaUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: [
        "id",
        "createdByMemberId",
        "title",
        "icon",
        "coverImage",
        "parentId",
        "order",
        "databaseId",
        "createdAt",
        "deletedAt",
      ],
    });
    this.pageTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndDeletedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "deletedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // DynamoDB: 한 번의 업데이트에 GSI 하나만 생성 가능 → 단계별 누적 추가.
    if (pageTableGsiStageAtLeast(pageTableGsiDeployStage, "all")) {
      this.pageTable.table.addGlobalSecondaryIndex({
        indexName: "byDatabaseAndOrder",
        partitionKey: { name: "databaseId", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "order", type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }
    // LC 보호 DB row 의 org/팀/프로젝트 scope 필터링용 sparse GSI.
    // 키 형식: `${databaseId}#${scopeId}`. 해당 속성이 없는 항목은 자동 미색인(sparse).
    if (pageTableGsiStageAtLeast(pageTableGsiDeployStage, "scope-org")) {
      this.pageTable.table.addGlobalSecondaryIndex({
        indexName: "byDbScopeOrg",
        partitionKey: { name: "dbScopeOrg", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "order", type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }
    if (pageTableGsiStageAtLeast(pageTableGsiDeployStage, "scope-team")) {
      this.pageTable.table.addGlobalSecondaryIndex({
        indexName: "byDbScopeTeam",
        partitionKey: { name: "dbScopeTeam", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "order", type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }
    if (pageTableGsiStageAtLeast(pageTableGsiDeployStage, "scope-project")) {
      this.pageTable.table.addGlobalSecondaryIndex({
        indexName: "byDbScopeProject",
        partitionKey: { name: "dbScopeProject", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "order", type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    this.databaseTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // 삭제된 DB(휴지통) 조회용 — Pages 의 byWorkspaceAndDeletedAt 와 동일 모델.
    this.databaseTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndDeletedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "deletedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.commentTable.table.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndUpdatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.commentTable.table.addGlobalSecondaryIndex({
      indexName: "byBlockId",
      partitionKey: { name: "blockId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["authorMemberId", "workspaceId"],
    });

    // image-gc 가 status(READY/PENDING) 별로 Query 하도록 GSI 추가(#2).
    // 기존 image-gc 는 ImageAsset 전체를 FilterExpression 으로 풀스캔했다.
    // PK=status, SK=createdAt → 상태별 + 생성시각 cutoff 조회를 인덱스만으로 처리.
    // 삭제 판단에 필요한 key 만 INCLUDE(id 는 base PK 라 자동 포함).
    this.imageAssetTable.table.addGlobalSecondaryIndex({
      indexName: "byStatus",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["key"],
    });

    new cdk.CfnOutput(this, "PageTableName", { value: this.pageTable.table.tableName });
    new cdk.CfnOutput(this, "DatabaseTableName", { value: this.databaseTable.table.tableName });
    new cdk.CfnOutput(this, "CommentTableName", { value: this.commentTable.table.tableName });
    new cdk.CfnOutput(this, "ImageAssetTableName", {
      value: this.imageAssetTable.table.tableName,
    });

    const notificationTable = new dynamodb.Table(this, "NotificationTable", {
      tableName: "quicknote-notification",
      partitionKey: { name: "recipientMemberId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "notificationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "expiresAt",
    });
    new cdk.CfnOutput(this, "NotificationTableName", { value: notificationTable.tableName });

    // v5 신규 테이블 5종 — workspace 기반 멀티 유저 협업 인프라
    const membersTable = new dynamodb.Table(this, "MembersTable", {
      tableName: props.membersTableName ?? "quicknote-members",
      partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
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
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // 팀 생성 시 이름 중복체크를 전체 Scan 대신 Query 로 처리(#7).
    // PK=nameLower(소문자 정규화 이름). createTeam/updateTeam 이 nameLower 를 함께 기록한다.
    // 테이블이 작아 ALL 프로젝션의 쓰기 증폭은 무시할 수준.
    teamsTable.addGlobalSecondaryIndex({
      indexName: "byName",
      partitionKey: { name: "nameLower", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const memberTeamsTable = new dynamodb.Table(this, "MemberTeamsTable", {
      tableName: props.memberTeamsTableName ?? "quicknote-member-teams",
      partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
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
      encryption: DYNAMODB_TABLE_ENCRYPTION,
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
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    workspaceAccessTable.addGlobalSecondaryIndex({
      indexName: "bySubject",
      partitionKey: { name: "subjectKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 조직(실) 테이블
    const organizationsTable = new dynamodb.Table(this, "OrganizationsTable", {
      tableName: props.organizationsTableName ?? "quicknote-organizations",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // 조직 생성 시 이름 중복체크를 전체 Scan 대신 Query 로 처리(#7).
    // PK=nameLower. createOrganization/updateOrganization 이 nameLower 를 함께 기록한다.
    organizationsTable.addGlobalSecondaryIndex({
      indexName: "byName",
      partitionKey: { name: "nameLower", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 멤버-조직 관계 테이블 (memberId PK, organizationId SK, byOrganization GSI)
    const memberOrganizationsTable = new dynamodb.Table(this, "MemberOrganizationsTable", {
      tableName: props.memberOrganizationsTableName ?? "quicknote-member-organizations",
      partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    memberOrganizationsTable.addGlobalSecondaryIndex({
      indexName: "byOrganization",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // LC 스케줄러 프로젝트 테이블 — 신규 생성
    const projectsTable = new dynamodb.Table(this, "SchedulerProjectsTable", {
      tableName: "quicknote-scheduler-projects",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    projectsTable.addGlobalSecondaryIndex({
      indexName: "byWorkspace",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // LC 스케줄러 공휴일 테이블 — 신규 생성
    const holidaysTable = new dynamodb.Table(this, "SchedulerHolidaysTable", {
      tableName: "quicknote-scheduler-holidays",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    holidaysTable.addGlobalSecondaryIndex({
      indexName: "byWorkspace",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // LC 스케줄러 주간 MM 원본 테이블
    const mmEntriesTable = new dynamodb.Table(this, "SchedulerMmEntriesTable", {
      tableName: "quicknote-scheduler-mm-entries",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    mmEntriesTable.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndWeek",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "weekStart", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    mmEntriesTable.addGlobalSecondaryIndex({
      indexName: "byEntry",
      partitionKey: { name: "entryId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 워크스페이스 공유 커스텀 아이콘 프리셋. 모든 멤버가 같은 아이콘 목록을 볼 수 있도록 동기화.
    // PK = id (UUID), GSI byWorkspace = (workspaceId, createdAt) — 최신순 정렬.
    const customIconsTable = new dynamodb.Table(this, "CustomIconsTable", {
      tableName: "quicknote-custom-icons",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    customIconsTable.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndCreatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    new cdk.CfnOutput(this, "CustomIconsTableName", { value: customIconsTable.tableName });

    // 자산(이미지/파일) 사용 위치 인덱스 테이블.
    // 한 자산이 어떤 페이지의 어떤 블록에서 쓰이는지 추적해 "사용 안 됨" 필터·삭제·교체에 사용.
    // PK = assetId (한 자산이 여러 페이지에서 참조될 수 있음, 핫키 위험은 자산당 사용처가 적어 낮음).
    // SK = "PAGE#{pageId}#BLOCK#{blockId}" — 같은 페이지에서 여러 블록이 같은 자산을 쓰면 별 row.
    // GSI byOwner: ownerId → 사용자의 모든 사용 매핑. listMyAssets 에서 자산별 usageCount 집계용.
    // GSI byPage: pageId → 페이지 전체 자산. 페이지 삭제/재기록 시 cascade.
    const assetUsageTable = new dynamodb.Table(this, "AssetUsageTable", {
      tableName: "quicknote-asset-usage",
      partitionKey: { name: "assetId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    assetUsageTable.addGlobalSecondaryIndex({
      indexName: "byOwner",
      partitionKey: { name: "ownerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "assetId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    assetUsageTable.addGlobalSecondaryIndex({
      indexName: "byPage",
      partitionKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    new cdk.CfnOutput(this, "AssetUsageTableName", { value: assetUsageTable.tableName });

    const pageHistoryTable = new dynamodb.Table(this, "PageHistoryTable", {
      tableName: "quicknote-page-history",
      partitionKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "historyId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    pageHistoryTable.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndCreatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // DB 소속 row 페이지 히스토리를 단일 쿼리로 모으기 위한 GSI.
    // databaseId 가 있는 항목(=row 페이지)만 색인되어 인덱스가 가볍다.
    pageHistoryTable.addGlobalSecondaryIndex({
      indexName: "byDatabaseAndCreatedAt",
      partitionKey: { name: "databaseId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    new cdk.CfnOutput(this, "PageHistoryTableName", { value: pageHistoryTable.tableName });

    const databaseHistoryTable = new dynamodb.Table(this, "DatabaseHistoryTable", {
      tableName: "quicknote-database-history",
      partitionKey: { name: "databaseId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "historyId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    databaseHistoryTable.addGlobalSecondaryIndex({
      indexName: "byWorkspaceAndCreatedAt",
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    databaseHistoryTable.addGlobalSecondaryIndex({
      indexName: "byOwnerAndCreatedAt",
      partitionKey: { name: "ownerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    new cdk.CfnOutput(this, "DatabaseHistoryTableName", { value: databaseHistoryTable.tableName });

    // LC 스케줄러 일정 테이블 — 1차 배포 시 이미 생성됐으므로 import로 참조.
    // GSI 권한 부여를 위해 fromTableAttributes 로 인덱스를 함께 등록한다.
    const schedulesTable = dynamodb.Table.fromTableAttributes(this, "SchedulesTable", {
      tableName: "quicknote-schedules",
      globalIndexes: ["byWorkspaceAndStartAt"],
    });
    new cdk.CfnOutput(this, "SchedulesTableName", { value: schedulesTable.tableName });

    // 작업 DB row 의 구성원(assignee)별 색인 테이블 — listDatabaseRows 의 assigneeId 필터용.
    // PK=`${databaseId}#${memberId}`, SK=pageId. assignee 마다 1엔트리(per-assignee).
    const databaseRowMembersTable = new dynamodb.Table(this, "DatabaseRowMembersTable", {
      tableName: "quicknote-database-row-members",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "pageId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: DYNAMODB_TABLE_ENCRYPTION,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, "DatabaseRowMembersTableName", {
      value: databaseRowMembersTable.tableName,
    });

    new cdk.CfnOutput(this, "MembersTableName", { value: membersTable.tableName });
    new cdk.CfnOutput(this, "TeamsTableName", { value: teamsTable.tableName });
    new cdk.CfnOutput(this, "MemberTeamsTableName", { value: memberTeamsTable.tableName });
    new cdk.CfnOutput(this, "WorkspacesTableName", { value: workspacesTable.tableName });
    new cdk.CfnOutput(this, "WorkspaceAccessTableName", { value: workspaceAccessTable.tableName });
    new cdk.CfnOutput(this, "OrganizationsTableName", { value: organizationsTable.tableName });
    new cdk.CfnOutput(this, "MemberOrganizationsTableName", { value: memberOrganizationsTable.tableName });

    this.membersTable = membersTable;
    this.teamsTable = teamsTable;
    this.memberTeamsTable = memberTeamsTable;
    this.workspacesTable = workspacesTable;
    this.workspaceAccessTable = workspaceAccessTable;
    this.organizationsTable = organizationsTable;
    this.memberOrganizationsTable = memberOrganizationsTable;

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
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGE_ASSET_TABLE: this.imageAssetTable.table.tableName,
        // getImageDownloadUrl 의 워크스페이스 멤버십 인가용.
        MEMBERS_TABLE: membersTable.tableName,
        MEMBER_TEAMS_TABLE: memberTeamsTable.tableName,
        WORKSPACE_ACCESS_TABLE: workspaceAccessTable.tableName,
        ASSET_USAGE_TABLE: assetUsageTable.tableName,
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
    // 다운로드 인가에 필요한 테이블 읽기 권한.
    membersTable.grantReadData(presignFn);
    memberTeamsTable.grantReadData(presignFn);
    workspaceAccessTable.grantReadData(presignFn);
    assetUsageTable.grantReadData(presignFn);

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
      runtime: lambda.Runtime.NODEJS_22_X,
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
    imagesBucket.grantRead(gcFn);
    imagesBucket.grantDelete(gcFn);

    new events.Rule(this, "ImageGcSchedule", {
      // UTC 18:00 = KST 03:00
      schedule: events.Schedule.cron({ minute: "0", hour: "18" }),
      targets: [new eventsTargets.LambdaFunction(gcFn)],
    });

    // 휴지통 보관(30일) 만료 페이지 — DynamoDB 에서 영구 삭제
    const trashPurgeFn = new lambdaNode.NodejsFunction(this, "TrashPurgeFn", {
      entry: path.join(__dirname, "..", "lambda", "trash-purge", "index.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
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
    // #1 백필 완료 후 휴지통 영구삭제는 Pages 테이블 TTL(purgeAt)이 무료로 처리한다.
    // 일일 풀스캔 EventBridge 스케줄(TrashPurgeSchedule)은 제거했다 — 매일 Pages 풀스캔 비용 제거.
    // trashPurgeFn 자체는 필요 시 수동 invoke 할 수 있도록 남겨둔다(스케줄 없음 = 호출 없음 = 비용 없음).
    new cdk.CfnOutput(this, "TrashPurgeFunctionName", {
      value: trashPurgeFn.functionName,
    });

    // v5-resolvers Lambda — 모든 v5 admin/workspace mutation/query 라우터
    // 타임아웃은 AppSync resolver 의 기본 한도(~30s) 에 맞춰 28s.
    // migrateAssetUsage 처럼 Scan 기반 무거운 mutation 도 단일 호출에서 처리 가능.
    const v5ResolversFn = new lambdaNode.NodejsFunction(this, "V5ResolversFn", {
      entry: path.join(__dirname, "..", "lambda", "v5-resolvers", "index.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(28),
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
        NOTIFICATIONS_TABLE_NAME: notificationTable.tableName,
        ORGANIZATIONS_TABLE_NAME: this.organizationsTable.tableName,
        MEMBER_ORGANIZATIONS_TABLE_NAME: this.memberOrganizationsTable.tableName,
        SCHEDULES_TABLE_NAME: schedulesTable.tableName,
        PROJECTS_TABLE_NAME: projectsTable.tableName,
        HOLIDAYS_TABLE_NAME: holidaysTable.tableName,
        MM_ENTRIES_TABLE_NAME: mmEntriesTable.tableName,
        IMAGE_ASSETS_TABLE_NAME: this.imageAssetTable.table.tableName,
        ASSET_USAGE_TABLE_NAME: assetUsageTable.tableName,
        PAGE_HISTORY_TABLE_NAME: pageHistoryTable.tableName,
        DATABASE_HISTORY_TABLE_NAME: databaseHistoryTable.tableName,
        DATABASE_ROW_MEMBERS_TABLE_NAME: databaseRowMembersTable.tableName,
        IMAGES_BUCKET_NAME: imagesBucket.bucketName,
        CUSTOM_ICONS_TABLE_NAME: customIconsTable.tableName,
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
    notificationTable.grantReadWriteData(v5ResolversFn);
    this.organizationsTable.grantReadWriteData(v5ResolversFn);
    this.memberOrganizationsTable.grantReadWriteData(v5ResolversFn);
    schedulesTable.grantReadWriteData(v5ResolversFn);
    projectsTable.grantReadWriteData(v5ResolversFn);
    holidaysTable.grantReadWriteData(v5ResolversFn);
    mmEntriesTable.grantReadWriteData(v5ResolversFn);
    this.imageAssetTable.table.grantReadWriteData(v5ResolversFn);
    assetUsageTable.grantReadWriteData(v5ResolversFn);
    pageHistoryTable.grantReadWriteData(v5ResolversFn);
    databaseHistoryTable.grantReadWriteData(v5ResolversFn);
    databaseRowMembersTable.grantReadWriteData(v5ResolversFn);
    imagesBucket.grantReadWrite(v5ResolversFn);
    customIconsTable.grantReadWriteData(v5ResolversFn);

    // DB 템플릿 자동 생성 — 30분 주기로 v5ResolversFn 을 스케줄 호출.
    // 이벤트에 info(fieldName)가 없으면 핸들러가 runTemplateAutomations 로 분기한다.
    // cron minute "0,30" = 매시 정각·30분(UTC). KST 는 UTC+9(분 오프셋 0)라 :00/:30 KST 에 정렬된다.
    new events.Rule(this, "TemplateAutomationSchedule", {
      schedule: events.Schedule.cron({ minute: "0,30" }),
      targets: [new eventsTargets.LambdaFunction(v5ResolversFn)],
    });

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
    v5Ds.createResolver("SetMemberRoleMutation", { typeName: "Mutation", fieldName: "setMemberRole" });
    v5Ds.createResolver("TransferOwnershipMutation", { typeName: "Mutation", fieldName: "transferOwnership" });
    v5Ds.createResolver("RemoveMemberMutation", { typeName: "Mutation", fieldName: "removeMember" });
    v5Ds.createResolver("RestoreMemberMutation", { typeName: "Mutation", fieldName: "restoreMember" });
    v5Ds.createResolver("AssignMemberToTeamMutation", { typeName: "Mutation", fieldName: "assignMemberToTeam" });
    v5Ds.createResolver("UnassignMemberFromTeamMutation", { typeName: "Mutation", fieldName: "unassignMemberFromTeam" });
    v5Ds.createResolver("ListTeamsQuery", { typeName: "Query", fieldName: "listTeams" });
    v5Ds.createResolver("GetTeamQuery", { typeName: "Query", fieldName: "getTeam" });
    v5Ds.createResolver("CreateTeamMutation", { typeName: "Mutation", fieldName: "createTeam" });
    v5Ds.createResolver("UpdateTeamMutation", { typeName: "Mutation", fieldName: "updateTeam" });
    v5Ds.createResolver("DeleteTeamMutation", { typeName: "Mutation", fieldName: "deleteTeam" });
    v5Ds.createResolver("ArchiveTeamMutation", { typeName: "Mutation", fieldName: "archiveTeam" });
    v5Ds.createResolver("RestoreTeamMutation", { typeName: "Mutation", fieldName: "restoreTeam" });
    // 조직(실) resolver wiring
    v5Ds.createResolver("ListOrganizationsQuery", { typeName: "Query", fieldName: "listOrganizations" });
    v5Ds.createResolver("CreateOrganizationMutation", { typeName: "Mutation", fieldName: "createOrganization" });
    v5Ds.createResolver("UpdateOrganizationMutation", { typeName: "Mutation", fieldName: "updateOrganization" });
    v5Ds.createResolver("DeleteOrganizationMutation", { typeName: "Mutation", fieldName: "deleteOrganization" });
    v5Ds.createResolver("AssignMemberToOrganizationMutation", { typeName: "Mutation", fieldName: "assignMemberToOrganization" });
    v5Ds.createResolver("UnassignMemberFromOrganizationMutation", { typeName: "Mutation", fieldName: "unassignMemberFromOrganization" });
    v5Ds.createResolver("ArchiveOrganizationMutation", { typeName: "Mutation", fieldName: "archiveOrganization" });
    v5Ds.createResolver("RestoreOrganizationMutation", { typeName: "Mutation", fieldName: "restoreOrganization" });
    v5Ds.createResolver("CreateWorkspaceMutation", { typeName: "Mutation", fieldName: "createWorkspace" });
    v5Ds.createResolver("UpdateWorkspaceMutation", { typeName: "Mutation", fieldName: "updateWorkspace" });
    v5Ds.createResolver("SetWorkspaceAccessMutation", { typeName: "Mutation", fieldName: "setWorkspaceAccess" });
    v5Ds.createResolver("DeleteWorkspaceMutation", { typeName: "Mutation", fieldName: "deleteWorkspace" });
    v5Ds.createResolver("ArchiveWorkspaceMutation", { typeName: "Mutation", fieldName: "archiveWorkspace" });
    v5Ds.createResolver("RestoreWorkspaceMutation", { typeName: "Mutation", fieldName: "restoreWorkspace" });
    v5Ds.createResolver("ListMyWorkspacesQuery", { typeName: "Query", fieldName: "listMyWorkspaces" });
    v5Ds.createResolver("GetWorkspaceQuery", { typeName: "Query", fieldName: "getWorkspace" });
    v5Ds.createResolver("SearchMembersForMentionQuery", { typeName: "Query", fieldName: "searchMembersForMention" });
    // 기존 배포의 Logical ID를 강제로 유지해 Resolver 교체 시 AlreadyExists를 피한다.
    const listPagesResolver = v5Ds.createResolver("QuerylistPages", {
      typeName: "Query",
      fieldName: "listPages",
    });
    (listPagesResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiQuerylistPagesB67FE9DA");

    v5Ds.createResolver("QuerylistPageMetas", {
      typeName: "Query",
      fieldName: "listPageMetas",
    });

    v5Ds.createResolver("QuerygetPage", {
      typeName: "Query",
      fieldName: "getPage",
    });

    v5Ds.createResolver("QuerylistDatabaseRows", {
      typeName: "Query",
      fieldName: "listDatabaseRows",
    });

    v5Ds.createResolver("QuerylistPageHistory", {
      typeName: "Query",
      fieldName: "listPageHistory",
    });

    v5Ds.createResolver("QuerylistDatabaseHistory", {
      typeName: "Query",
      fieldName: "listDatabaseHistory",
    });

    v5Ds.createResolver("QuerylistDatabaseRowHistory", {
      typeName: "Query",
      fieldName: "listDatabaseRowHistory",
    });

    const listDatabasesResolver = v5Ds.createResolver("QuerylistDatabases", {
      typeName: "Query",
      fieldName: "listDatabases",
    });
    (listDatabasesResolver.node.defaultChild as appsync.CfnResolver).overrideLogicalId("SyncApiQuerylistDatabasesC5178196");

    v5Ds.createResolver("QuerygetDatabase", {
      typeName: "Query",
      fieldName: "getDatabase",
    });

    v5Ds.createResolver("QuerylistTrashedPages", {
      typeName: "Query",
      fieldName: "listTrashedPages",
    });

    v5Ds.createResolver("QuerylistTrashedDatabases", {
      typeName: "Query",
      fieldName: "listTrashedDatabases",
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
    v5Ds.createResolver("QuerylistMyNotifications", {
      typeName: "Query",
      fieldName: "listMyNotifications",
    });
    v5Ds.createResolver("MutationmarkNotificationRead", {
      typeName: "Mutation",
      fieldName: "markNotificationRead",
    });
    v5Ds.createResolver("MutationdeleteMyNotification", {
      typeName: "Mutation",
      fieldName: "deleteMyNotification",
    });
    v5Ds.createResolver("SubscriptiononCommentChanged", {
      typeName: "Subscription",
      fieldName: "onCommentChanged",
    });

    v5Ds.createResolver("MutationrestorePage", {
      typeName: "Mutation",
      fieldName: "restorePage",
    });

    v5Ds.createResolver("MutationrestoreDatabase", {
      typeName: "Mutation",
      fieldName: "restoreDatabase",
    });

    v5Ds.createResolver("MutationrestorePageVersion", {
      typeName: "Mutation",
      fieldName: "restorePageVersion",
    });

    v5Ds.createResolver("MutationdeletePageHistoryEvents", {
      typeName: "Mutation",
      fieldName: "deletePageHistoryEvents",
    });

    v5Ds.createResolver("MutationrestoreDatabaseVersion", {
      typeName: "Mutation",
      fieldName: "restoreDatabaseVersion",
    });

    v5Ds.createResolver("MutationdeleteDatabaseHistoryEvents", {
      typeName: "Mutation",
      fieldName: "deleteDatabaseHistoryEvents",
    });

    v5Ds.createResolver("MutationemptyTrash", {
      typeName: "Mutation",
      fieldName: "emptyTrash",
    });

    v5Ds.createResolver("MutationpermanentlyDeletePage", {
      typeName: "Mutation",
      fieldName: "permanentlyDeletePage",
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
    v5Ds.createResolver("MutationpermanentlyDeleteDatabase", {
      typeName: "Mutation",
      fieldName: "permanentlyDeleteDatabase",
    });

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

    v5Ds.createResolver("QuerylistSchedules", { typeName: "Query", fieldName: "listSchedules" });
    v5Ds.createResolver("MutationcreateSchedule", { typeName: "Mutation", fieldName: "createSchedule" });
    v5Ds.createResolver("MutationupdateSchedule", { typeName: "Mutation", fieldName: "updateSchedule" });
    v5Ds.createResolver("MutationdeleteSchedule", { typeName: "Mutation", fieldName: "deleteSchedule" });
    v5Ds.createResolver("SubscriptiononScheduleChanged", { typeName: "Subscription", fieldName: "onScheduleChanged" });
    // 프로젝트 resolver wiring
    v5Ds.createResolver("QuerylistProjects", { typeName: "Query", fieldName: "listProjects" });
    v5Ds.createResolver("QuerygetWorkspaceMeta", { typeName: "Query", fieldName: "getWorkspaceMeta" });
    v5Ds.createResolver("MutationcreateProject", { typeName: "Mutation", fieldName: "createProject" });
    v5Ds.createResolver("MutationupdateProject", { typeName: "Mutation", fieldName: "updateProject" });
    v5Ds.createResolver("MutationdeleteProject", { typeName: "Mutation", fieldName: "deleteProject" });
    v5Ds.createResolver("SubscriptiononProjectChanged", { typeName: "Subscription", fieldName: "onProjectChanged" });
    // 공휴일 resolver wiring
    v5Ds.createResolver("QuerylistHolidays", { typeName: "Query", fieldName: "listHolidays" });
    v5Ds.createResolver("MutationcreateHoliday", { typeName: "Mutation", fieldName: "createHoliday" });
    v5Ds.createResolver("MutationupdateHoliday", { typeName: "Mutation", fieldName: "updateHoliday" });
    v5Ds.createResolver("MutationdeleteHoliday", { typeName: "Mutation", fieldName: "deleteHoliday" });
    v5Ds.createResolver("SubscriptiononHolidayChanged", { typeName: "Subscription", fieldName: "onHolidayChanged" });
    // 주간 MM resolver wiring
    v5Ds.createResolver("QuerylistMmEntries", { typeName: "Query", fieldName: "listMmEntries" });
    v5Ds.createResolver("QuerylistMmRevisions", { typeName: "Query", fieldName: "listMmRevisions" });
    v5Ds.createResolver("MutationupsertMmEntry", { typeName: "Mutation", fieldName: "upsertMmEntry" });
    v5Ds.createResolver("MutationreviewMmEntry", { typeName: "Mutation", fieldName: "reviewMmEntry" });
    v5Ds.createResolver("MutationlockMmEntry", { typeName: "Mutation", fieldName: "lockMmEntry" });
    v5Ds.createResolver("MutationunlockMmEntry", { typeName: "Mutation", fieldName: "unlockMmEntry" });
    v5Ds.createResolver("SubscriptiononMmEntryChanged", { typeName: "Subscription", fieldName: "onMmEntryChanged" });

    // 워크스페이스 공유 커스텀 아이콘.
    v5Ds.createResolver("QuerylistCustomIcons", { typeName: "Query", fieldName: "listCustomIcons" });
    v5Ds.createResolver("MutationcreateCustomIcon", { typeName: "Mutation", fieldName: "createCustomIcon" });
    v5Ds.createResolver("MutationdeleteCustomIcon", { typeName: "Mutation", fieldName: "deleteCustomIcon" });
    v5Ds.createResolver("SubscriptiononCustomIconChanged", { typeName: "Subscription", fieldName: "onCustomIconChanged" });
    // 워크스페이스 접근권한 변경 실시간 구독.
    v5Ds.createResolver("SubscriptiononWorkspaceChanged", { typeName: "Subscription", fieldName: "onWorkspaceChanged" });

    // 자산 관리 — 사용자 단위 자산 목록·사용 위치·삭제·교체.
    v5Ds.createResolver("QuerylistMyAssets", { typeName: "Query", fieldName: "listMyAssets" });
    v5Ds.createResolver("QuerygetAssetUsages", { typeName: "Query", fieldName: "getAssetUsages" });
    v5Ds.createResolver("MutationdeleteMyAssets", { typeName: "Mutation", fieldName: "deleteMyAssets" });
    v5Ds.createResolver("MutationrenameAsset", { typeName: "Mutation", fieldName: "renameAsset" });
    v5Ds.createResolver("MutationreplaceAssetRef", { typeName: "Mutation", fieldName: "replaceAssetRef" });
    v5Ds.createResolver("MutationmigrateAssetUsage", { typeName: "Mutation", fieldName: "migrateAssetUsage" });

    // v5 데이터 마이그레이션 Lambda (v4 ownerId -> v5 workspace/member 필드 보강)
    const v5MigrationFn = new lambdaNode.NodejsFunction(this, "V5MigrationFn", {
      entry: path.join(__dirname, "..", "lambda", "v5-migration", "index.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
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
