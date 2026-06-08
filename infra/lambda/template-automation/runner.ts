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
  TemplateAutomationRuns: string;
};

type UpsertPageFn = typeof upsertPage;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env is required`);
  return value;
}

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

export async function runTemplateAutomation(args: {
  doc: DynamoDBDocumentClientType;
  tables: RunnerTables;
  event: TemplateAutomationEvent;
  now?: () => Date;
  upsertPageFn?: UpsertPageFn;
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
