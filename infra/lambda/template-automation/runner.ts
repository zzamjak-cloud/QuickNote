import { createHash, createHmac } from "node:crypto";
import { requireEnv } from "../_shared/env";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient as DynamoDBDocumentClientType,
} from "@aws-sdk/lib-dynamodb";
import type { Member, Tables } from "../v5-resolvers/handlers/member";
import { upsertPage } from "../v5-resolvers/handlers/pageDatabase";
import {
  buildGeneratedTemplatePage,
  buildTemplateAutomationPageId,
  buildTemplateAutomationRunId,
  collectTemplateAutomationTargets,
} from "./common";

type TemplateAutomationEvent = {
  type?: string;
  databaseId?: string;
  templateId?: string;
  automationId?: string;
  scheduledTime?: string;
  executionId?: string;
  attemptNumber?: string | number;
  scheduleArn?: string;
};

type RunnerTables = Tables & {
  Members: string;
  Pages: string;
  Databases: string;
  TemplateAutomationRuns: string;
};

type UpsertPageFn = typeof upsertPage;
type PublishPageChangedFn = (page: Record<string, unknown>) => Promise<void>;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PUBLISH_PAGE_CHANGED_MUTATION = `
mutation PublishPageChanged($input: PageInput!) {
  publishPageChanged(input: $input) {
    id
    workspaceId
    createdByMemberId
    title
    icon
    coverImage
    parentId
    order
    databaseId
    fullPageDatabaseId
    doc
    dbCells
    blockComments
    createdAt
    updatedAt
    deletedAt
  }
}`;

function readTablesFromEnv(): RunnerTables {
  return {
    Members: requireEnv("MEMBERS_TABLE_NAME"),
    Teams: requireEnv("TEAMS_TABLE_NAME"),
    MemberTeams: requireEnv("MEMBER_TEAMS_TABLE_NAME"),
    Workspaces: requireEnv("WORKSPACES_TABLE_NAME"),
    WorkspaceAccess: requireEnv("WORKSPACE_ACCESS_TABLE_NAME"),
    Pages: requireEnv("PAGES_TABLE_NAME"),
    Databases: requireEnv("DATABASES_TABLE_NAME"),
    Comments: process.env.COMMENTS_TABLE_NAME,
    Schedules: process.env.SCHEDULES_TABLE_NAME,
    DatabaseRowMembers: process.env.DATABASE_ROW_MEMBERS_TABLE_NAME,
    PageHistory: process.env.PAGE_HISTORY_TABLE_NAME,
    DatabaseHistory: process.env.DATABASE_HISTORY_TABLE_NAME,
    ImageAssets: process.env.IMAGE_ASSETS_TABLE_NAME,
    AssetUsage: process.env.ASSET_USAGE_TABLE_NAME,
    ImagesBucketName: process.env.IMAGES_BUCKET_NAME,
    TemplateAutomationRuns: requireEnv("TEMPLATE_AUTOMATION_RUNS_TABLE_NAME"),
  };
}

function toAwsJsonInput(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function toPublishPageChangedInput(page: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: page.id,
    workspaceId: page.workspaceId,
    createdByMemberId: page.createdByMemberId,
    title: page.title,
    order: page.order,
    databaseId: page.databaseId ?? null,
    fullPageDatabaseId: page.fullPageDatabaseId ?? null,
    doc: toAwsJsonInput(page.doc) ?? JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    dbCells: toAwsJsonInput(page.dbCells),
    blockComments: toAwsJsonInput(page.blockComments),
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
  for (const key of ["icon", "coverImage", "parentId"]) {
    if (page[key] != null) input[key] = page[key];
  }
  return input;
}

function amzDateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function hashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "appsync");
  return hmac(kService, "aws4_request");
}

function signedAppSyncHeaders(args: {
  endpoint: string;
  body: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Record<string, string> {
  const env = args.env ?? process.env;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = env.AWS_SESSION_TOKEN;
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "ap-northeast-2";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are required to publish AppSync page change");
  }
  const url = new URL(args.endpoint);
  const { amzDate, dateStamp } = amzDateParts(args.now);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: url.host,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}`)
    .join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "POST",
    url.pathname || "/graphql",
    "",
    canonicalHeaders,
    signedHeaders,
    hashHex(args.body),
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/appsync/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(secretAccessKey, dateStamp, region))
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export async function publishPageChangedToAppSync(page: Record<string, unknown>): Promise<void> {
  const endpoint = requireEnv("APPSYNC_GRAPHQL_URL");
  const body = JSON.stringify({
    query: PUBLISH_PAGE_CHANGED_MUTATION,
    variables: { input: toPublishPageChangedInput(page) },
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: signedAppSyncHeaders({ endpoint, body }),
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`publishPageChanged HTTP ${response.status}: ${text}`);
  }
  const parsed = text ? JSON.parse(text) as { errors?: Array<{ message?: string }> } : {};
  if (parsed.errors?.length) {
    throw new Error(`publishPageChanged failed: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
}

function assertEvent(event: TemplateAutomationEvent): asserts event is Required<
  Pick<TemplateAutomationEvent, "databaseId" | "templateId" | "automationId">
> &
  TemplateAutomationEvent {
  if (event.type !== "databaseTemplateAutomation") throw new Error("Invalid automation event type");
  if (!event.databaseId || !event.templateId || !event.automationId) {
    throw new Error("Automation event missing identifiers");
  }
}

async function putRun(args: {
  doc: DynamoDBDocumentClientType;
  tableName: string;
  item: Record<string, unknown>;
}) {
  await args.doc.send(
    new PutCommand({
      TableName: args.tableName,
      Item: args.item,
    }),
  );
}

async function getAutomationOwnerMember(args: {
  doc: DynamoDBDocumentClientType;
  tableName: string;
  memberIdOrCognitoSub: string;
}): Promise<Member> {
  const result = await args.doc.send(
    new GetCommand({
      TableName: args.tableName,
      Key: { memberId: args.memberIdOrCognitoSub },
    }),
  );
  let member = result.Item as Member | undefined;
  if (!member) {
    const byCognitoSub = await args.doc.send(
      new QueryCommand({
        TableName: args.tableName,
        IndexName: "byCognitoSub",
        KeyConditionExpression: "cognitoSub = :s",
        ExpressionAttributeValues: { ":s": args.memberIdOrCognitoSub },
        Limit: 1,
      }),
    );
    member = byCognitoSub.Items?.[0] as Member | undefined;
  }
  if (!member || member.status !== "active") {
    throw new Error(`Automation owner member is not active: ${args.memberIdOrCognitoSub}`);
  }
  return member;
}

async function collectExistingDatabaseTitles(args: {
  doc: DynamoDBDocumentClientType;
  tableName: string;
  databaseId: string;
}): Promise<string[]> {
  const titles: string[] = [];
  let nextKey: Record<string, unknown> | undefined;
  do {
    const result = await args.doc.send(
      new QueryCommand({
        TableName: args.tableName,
        IndexName: "byDatabaseAndOrder",
        KeyConditionExpression: "databaseId = :databaseId",
        ExpressionAttributeValues: { ":databaseId": args.databaseId },
        ProjectionExpression: "title",
        ExclusiveStartKey: nextKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if (typeof item.title === "string") titles.push(item.title);
    }
    nextKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (nextKey);
  return titles;
}

export async function runTemplateAutomation(args: {
  doc: DynamoDBDocumentClientType;
  tables: RunnerTables;
  event: TemplateAutomationEvent;
  now?: () => Date;
  upsertPageFn?: UpsertPageFn;
  publishPageChangedFn?: PublishPageChangedFn;
}) {
  assertEvent(args.event);
  const now = args.now?.() ?? new Date();
  const nowIso = now.toISOString();
  const scheduledTime = args.event.scheduledTime || nowIso;
  const runId = buildTemplateAutomationRunId({
    automationId: args.event.automationId,
    scheduledTime,
  });
  const pageId = buildTemplateAutomationPageId({
    automationId: args.event.automationId,
    scheduledTime,
  });

  const existingRun = await args.doc.send(
    new GetCommand({
      TableName: args.tables.TemplateAutomationRuns,
      Key: { id: runId },
    }),
  );
  const runItem = existingRun.Item as Record<string, unknown> | undefined;
  if (runItem?.status === "succeeded") {
    return { status: "already-succeeded", runId, pageId: runItem.pageId ?? pageId };
  }

  const databaseResult = await args.doc.send(
    new GetCommand({
      TableName: args.tables.Databases,
      Key: { id: args.event.databaseId },
    }),
  );
  const database = databaseResult.Item as Record<string, unknown> | undefined;
  if (!database) throw new Error(`Database not found: ${args.event.databaseId}`);

  const target = collectTemplateAutomationTargets(database).find(
    (item) =>
      item.template.id === args.event.templateId &&
      item.automation.id === args.event.automationId,
  );
  if (!target || !target.automation.enabled) {
    await putRun({
      doc: args.doc,
      tableName: args.tables.TemplateAutomationRuns,
      item: {
        id: runId,
        automationId: args.event.automationId,
        databaseId: args.event.databaseId,
        templateId: args.event.templateId,
        scheduledTime,
        status: "skipped",
        reason: "automation-disabled-or-missing",
        attempts: runItem?.attempts ?? 0,
        updatedAt: nowIso,
      },
    });
    return { status: "skipped", runId, pageId };
  }

  const maxAttempts = target.automation.maxAttempts ?? 3;
  const nextAttempts = Number(runItem?.attempts ?? 0) + 1;
  if (nextAttempts > maxAttempts) {
    await putRun({
      doc: args.doc,
      tableName: args.tables.TemplateAutomationRuns,
      item: {
        ...(runItem ?? {}),
        id: runId,
        automationId: args.event.automationId,
        databaseId: args.event.databaseId,
        templateId: args.event.templateId,
        scheduledTime,
        status: "failed",
        reason: "max-attempts-exceeded",
        attempts: runItem?.attempts ?? maxAttempts,
        updatedAt: nowIso,
      },
    });
    return { status: "failed", runId, pageId };
  }

  await putRun({
    doc: args.doc,
    tableName: args.tables.TemplateAutomationRuns,
    item: {
      ...(runItem ?? {}),
      id: runId,
      automationId: args.event.automationId,
      databaseId: args.event.databaseId,
      templateId: args.event.templateId,
      scheduledTime,
      scheduleArn: args.event.scheduleArn ?? null,
      executionId: args.event.executionId ?? null,
      schedulerAttemptNumber: args.event.attemptNumber ?? null,
      status: "running",
      attempts: nextAttempts,
      updatedAt: nowIso,
    },
  });

  try {
    const templatePage = target.template.pageId
      ? (await args.doc.send(
          new GetCommand({
            TableName: args.tables.Pages,
            Key: { id: target.template.pageId },
          }),
        )).Item as Record<string, unknown> | undefined
      : null;
    const existingPage = await args.doc.send(
      new GetCommand({
        TableName: args.tables.Pages,
        Key: { id: pageId },
      }),
    );
    if (existingPage.Item) {
      await (args.publishPageChangedFn ?? publishPageChangedToAppSync)(
        existingPage.Item as Record<string, unknown>,
      );
      await putRun({
        doc: args.doc,
        tableName: args.tables.TemplateAutomationRuns,
        item: {
          ...(runItem ?? {}),
          id: runId,
          automationId: args.event.automationId,
          databaseId: args.event.databaseId,
          templateId: args.event.templateId,
          scheduledTime,
          status: "succeeded",
          attempts: nextAttempts,
          pageId,
          completedAt: nowIso,
          updatedAt: nowIso,
        },
      });
      return { status: "succeeded", runId, pageId };
    }

    const caller = await getAutomationOwnerMember({
      doc: args.doc,
      tableName: args.tables.Members,
      memberIdOrCognitoSub: String(database.createdByMemberId ?? ""),
    });
    const pageInput = buildGeneratedTemplatePage({
      database,
      template: target.template,
      templatePage,
      existingTitles: await collectExistingDatabaseTitles({
        doc: args.doc,
        tableName: args.tables.Pages,
        databaseId: args.event.databaseId,
      }),
      scheduledTime,
      pageId,
      nowIso,
    });
    await (args.upsertPageFn ?? upsertPage)({
      doc: args.doc,
      tables: args.tables,
      caller,
      input: pageInput,
    });
    await (args.publishPageChangedFn ?? publishPageChangedToAppSync)(pageInput);
    await putRun({
      doc: args.doc,
      tableName: args.tables.TemplateAutomationRuns,
      item: {
        ...(runItem ?? {}),
        id: runId,
        automationId: args.event.automationId,
        databaseId: args.event.databaseId,
        templateId: args.event.templateId,
        scheduledTime,
        status: "succeeded",
        attempts: nextAttempts,
        pageId,
        completedAt: nowIso,
        updatedAt: nowIso,
      },
    });
    return { status: "succeeded", runId, pageId };
  } catch (err) {
    await putRun({
      doc: args.doc,
      tableName: args.tables.TemplateAutomationRuns,
      item: {
        ...(runItem ?? {}),
        id: runId,
        automationId: args.event.automationId,
        databaseId: args.event.databaseId,
        templateId: args.event.templateId,
        scheduledTime,
        status: "failed",
        attempts: nextAttempts,
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: nowIso,
      },
    });
    if (nextAttempts >= maxAttempts) {
      return { status: "failed", runId, pageId };
    }
    throw err;
  }
}

export async function handler(event: TemplateAutomationEvent) {
  return await runTemplateAutomation({
    doc: ddb,
    tables: readTablesFromEnv(),
    event,
  });
}
