import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
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

    // 자원은 후속 Task 들에서 추가된다.
    void userPool;
  }
}
