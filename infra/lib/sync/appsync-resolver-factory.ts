import * as path from "node:path";
import * as appsync from "aws-cdk-lib/aws-appsync";
import type { ModelTable } from "./ddb-table-factory";

const DIST = path.join(__dirname, "resolvers", "dist");

// 3 owner-scoped 모델(Page/Database/Contact)에 동일한 LWW 리졸버를 부착한다.
// upsert / softDelete / list 는 DDB 데이터소스, on*Changed 구독은 NONE 데이터소스에
// 검증 함수만 매단다.
export function attachOwnerScopedModelResolvers(
  api: appsync.GraphqlApi,
  modelName: "Page" | "Database" | "Contact",
  table: ModelTable,
): void {
  const ds = api.addDynamoDbDataSource(`${modelName}Ds`, table.table);
  const runtime = appsync.FunctionRuntime.JS_1_0_0;

  ds.createResolver(`Mutation_upsert${modelName}`, {
    typeName: "Mutation",
    fieldName: `upsert${modelName}`,
    runtime,
    code: appsync.Code.fromAsset(path.join(DIST, "upsert.js")),
  });
  ds.createResolver(`Mutation_softDelete${modelName}`, {
    typeName: "Mutation",
    fieldName: `softDelete${modelName}`,
    runtime,
    code: appsync.Code.fromAsset(path.join(DIST, "softDelete.js")),
  });
  ds.createResolver(`Query_list${modelName}s`, {
    typeName: "Query",
    fieldName: `list${modelName}s`,
    runtime,
    code: appsync.Code.fromAsset(path.join(DIST, "list.js")),
  });

  const noneDs = api.addNoneDataSource(`${modelName}NoneDs`);
  noneDs.createResolver(`Subscription_on${modelName}Changed`, {
    typeName: "Subscription",
    fieldName: `on${modelName}Changed`,
    runtime,
    code: appsync.Code.fromAsset(path.join(DIST, "subscribe.js")),
  });
}
