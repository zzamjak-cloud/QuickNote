import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { describe, expect, it, vi } from "vitest";
import {
  buildTemplateAutomationScheduleCommandInput,
  reconcileTemplateAutomationSchedules,
} from "./templateAutomationScheduler";
import type { TemplateAutomationTarget } from "../../template-automation/common";

const config = {
  groupName: "quicknote-template-automation",
  runnerArn: "arn:aws:lambda:ap-northeast-2:123:function:runner",
  roleArn: "arn:aws:iam::123:role/scheduler-role",
};

const target: TemplateAutomationTarget = {
  template: {
    id: "template-1",
    title: "QA",
    cells: {},
    pageId: "template-page-1",
  },
  automation: {
    id: "automation-1",
    enabled: true,
    weekdays: [1, 3],
    time: "09:30",
    timezone: "Asia/Seoul",
    maxAttempts: 3,
  },
};

describe("templateAutomationScheduler", () => {
  it("builds scheduler target input with context attributes and bounded retry", () => {
    const input = buildTemplateAutomationScheduleCommandInput({
      config,
      databaseId: "db-1",
      target,
    });

    expect(input.ScheduleExpression).toBe("cron(30 9 ? * MON,WED *)");
    expect(input.ScheduleExpressionTimezone).toBe("Asia/Seoul");
    expect(input.Target.RetryPolicy).toEqual({
      MaximumRetryAttempts: 2,
      MaximumEventAgeInSeconds: 3600,
    });
    expect(JSON.parse(input.Target.Input)).toEqual({
      type: "databaseTemplateAutomation",
      databaseId: "db-1",
      templateId: "template-1",
      automationId: "automation-1",
      scheduledTime: "<aws.scheduler.scheduled-time>",
      executionId: "<aws.scheduler.execution-id>",
      attemptNumber: "<aws.scheduler.attempt-number>",
      scheduleArn: "<aws.scheduler.schedule-arn>",
    });
  });

  it("creates schedule when update reports not found", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "ResourceNotFoundException" }))
      .mockResolvedValueOnce({});

    await reconcileTemplateAutomationSchedules({
      scheduler: { send },
      config,
      before: null,
      after: {
        id: "db-1",
        templates: JSON.stringify([{ ...target.template, automation: target.automation }]),
      },
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(UpdateScheduleCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateScheduleCommand);
  });

  it("deletes schedule when automation is disabled", async () => {
    const send = vi.fn().mockResolvedValue({});

    await reconcileTemplateAutomationSchedules({
      scheduler: { send },
      config,
      before: {
        id: "db-1",
        templates: JSON.stringify([{ ...target.template, automation: target.automation }]),
      },
      after: {
        id: "db-1",
        templates: JSON.stringify([
          { ...target.template, automation: { ...target.automation, enabled: false } },
        ]),
      },
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteScheduleCommand);
  });
});
