import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { DYNAMODB_TABLE_ENCRYPTION } from "./table-encryption";

export type SyncModelName = "Page" | "Database" | "Contact" | "ImageAsset" | "Comment";

export interface ModelTable {
  table: dynamodb.Table;
  byOwnerIndexName: string;
}

export function createSyncTable(
  scope: Construct,
  id: string,
  modelName: SyncModelName,
  opts: { ttlAttribute?: string } = {},
): ModelTable {
  const table = new dynamodb.Table(scope, id, {
    tableName: `quicknote-${modelName.toLowerCase()}`,
    partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    timeToLiveAttribute: opts.ttlAttribute,
    encryption: DYNAMODB_TABLE_ENCRYPTION,
  });

  // ImageAsset 은 createdAt, 나머지는 updatedAt 으로 정렬.
  const sortKeyName = modelName === "ImageAsset" ? "createdAt" : "updatedAt";
  const byOwnerIndexName = "byOwner";
  table.addGlobalSecondaryIndex({
    indexName: byOwnerIndexName,
    partitionKey: { name: "ownerId", type: dynamodb.AttributeType.STRING },
    sortKey: { name: sortKeyName, type: dynamodb.AttributeType.STRING },
    projectionType: dynamodb.ProjectionType.ALL,
  });

  return { table, byOwnerIndexName };
}
