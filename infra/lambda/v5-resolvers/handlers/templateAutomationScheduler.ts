import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
  type SchedulerClient as SchedulerClientType,
} from "@aws-sdk/client-scheduler";
import {
  TEMPLATE_AUTOMATION_MAX_EVENT_AGE_SECONDS,
  buildTemplateAutomationScheduleExpression,
  buildTemplateAutomationScheduleName,
  collectTemplateAutomationTargets,
  type TemplateAutomationConfig,
  type TemplateAutomationTarget,
} from "../../template-automation/common";

type SchedulerLike = Pick<SchedulerClientType, "send">;

export type TemplateAutomationSchedulerConfig = {
  groupName: string;
  runnerArn: string;
  roleArn: string;
};

export type ReconcileTemplateAutomationSchedulesArgs = {
  scheduler?: SchedulerLike;
  config?: TemplateAutomationSchedulerConfig | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

const defaultScheduler = new SchedulerClient({});

export function readTemplateAutomationSchedulerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TemplateAutomationSchedulerConfig | null {
  const groupName = env.TEMPLATE_AUTOMATION_SCHEDULE_GROUP_NAME;
  const runnerArn = env.TEMPLATE_AUTOMATION_RUNNER_ARN;
  const roleArn = env.TEMPLATE_AUTOMATION_SCHEDULER_ROLE_ARN;
  if (!groupName || !runnerArn || !roleArn) return null;
  return { groupName, runnerArn, roleArn };
}

function targetKey(target: TemplateAutomationTarget): string {
  return target.automation.id;
}

function shouldDeleteAutomation(automation: TemplateAutomationConfig): boolean {
  if (!automation.enabled) return true;
  if (!automation.endDate) return false;
  return automation.endDate < new Date().toISOString().slice(0, 10);
}

function buildScheduleTargetInput(args: {
  databaseId: string;
  templateId: string;
  automationId: string;
}): string {
  return JSON.stringify({
    type: "databaseTemplateAutomation",
    databaseId: args.databaseId,
    templateId: args.templateId,
    automationId: args.automationId,
    scheduledTime: "<aws.scheduler.scheduled-time>",
    executionId: "<aws.scheduler.execution-id>",
    attemptNumber: "<aws.scheduler.attempt-number>",
    scheduleArn: "<aws.scheduler.schedule-arn>",
  });
}

export function buildTemplateAutomationScheduleCommandInput(args: {
  config: TemplateAutomationSchedulerConfig;
  databaseId: string;
  target: TemplateAutomationTarget;
}) {
  const automation = args.target.automation;
  const maximumRetryAttempts = Math.max(0, (automation.maxAttempts ?? 3) - 1);
  return {
    GroupName: args.config.groupName,
    Name: buildTemplateAutomationScheduleName({
      databaseId: args.databaseId,
      templateId: args.target.template.id,
      automationId: automation.id,
    }),
    ScheduleExpression: buildTemplateAutomationScheduleExpression(automation),
    ScheduleExpressionTimezone: automation.timezone,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    State: "ENABLED" as const,
    Target: {
      Arn: args.config.runnerArn,
      RoleArn: args.config.roleArn,
      Input: buildScheduleTargetInput({
        databaseId: args.databaseId,
        templateId: args.target.template.id,
        automationId: automation.id,
      }),
      RetryPolicy: {
        MaximumRetryAttempts: maximumRetryAttempts,
        MaximumEventAgeInSeconds: TEMPLATE_AUTOMATION_MAX_EVENT_AGE_SECONDS,
      },
    },
  };
}

async function upsertSchedule(args: {
  scheduler: SchedulerLike;
  config: TemplateAutomationSchedulerConfig;
  databaseId: string;
  target: TemplateAutomationTarget;
}): Promise<void> {
  const input = buildTemplateAutomationScheduleCommandInput(args);
  try {
    await args.scheduler.send(new UpdateScheduleCommand(input));
  } catch (err) {
    if (err instanceof ResourceNotFoundException || (err as { name?: string })?.name === "ResourceNotFoundException") {
      try {
        await args.scheduler.send(new CreateScheduleCommand(input));
      } catch (createErr) {
        if (createErr instanceof ConflictException || (createErr as { name?: string })?.name === "ConflictException") {
          await args.scheduler.send(new UpdateScheduleCommand(input));
          return;
        }
        throw createErr;
      }
      return;
    }
    throw err;
  }
}

async function deleteSchedule(args: {
  scheduler: SchedulerLike;
  config: TemplateAutomationSchedulerConfig;
  databaseId: string;
  target: TemplateAutomationTarget;
}): Promise<void> {
  const name = buildTemplateAutomationScheduleName({
    databaseId: args.databaseId,
    templateId: args.target.template.id,
    automationId: args.target.automation.id,
  });
  try {
    await args.scheduler.send(
      new DeleteScheduleCommand({
        GroupName: args.config.groupName,
        Name: name,
      }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException || (err as { name?: string })?.name === "ResourceNotFoundException") {
      return;
    }
    throw err;
  }
}

export async function reconcileTemplateAutomationSchedules({
  scheduler = defaultScheduler,
  config = readTemplateAutomationSchedulerConfigFromEnv(),
  before,
  after,
}: ReconcileTemplateAutomationSchedulesArgs): Promise<void> {
  if (!config || !after) return;
  const databaseId = typeof after.id === "string" ? after.id : "";
  if (!databaseId) return;

  const previousTargets = new Map(
    collectTemplateAutomationTargets(before).map((target) => [targetKey(target), target]),
  );
  const nextTargets = new Map(
    collectTemplateAutomationTargets(after).map((target) => [targetKey(target), target]),
  );

  for (const [automationId, previousTarget] of previousTargets) {
    const nextTarget = nextTargets.get(automationId);
    if (!nextTarget || shouldDeleteAutomation(nextTarget.automation)) {
      await deleteSchedule({ scheduler, config, databaseId, target: previousTarget });
    }
  }

  for (const target of nextTargets.values()) {
    if (shouldDeleteAutomation(target.automation)) {
      await deleteSchedule({ scheduler, config, databaseId, target });
      continue;
    }
    await upsertSchedule({ scheduler, config, databaseId, target });
  }
}
