import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import { createSyncTable, type ModelTable } from "./sync/ddb-table-factory";

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

    // 자원은 후속 Task 들에서 추가된다.
    void userPool;
  }
}
