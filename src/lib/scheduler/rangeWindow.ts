import { toIsoEndOfDay, toIsoStartOfDay } from "./dateUtils";

type SchedulerFetchWindowInput = {
  currentYear: number;
  now?: Date;
};

type SchedulerFetchWindow = {
  from: string;
  to: string;
};

function clampMonth(month: number): number {
  return Math.max(0, Math.min(11, month));
}

export function getSchedulerFetchWindow({
  currentYear,
  now = new Date(),
}: SchedulerFetchWindowInput): SchedulerFetchWindow {
  const centerMonth = now.getFullYear() === currentYear ? now.getMonth() : 0;
  const fromMonth = clampMonth(centerMonth - 1);
  const toMonth = clampMonth(centerMonth + 1);

  return {
    from: toIsoStartOfDay(new Date(currentYear, fromMonth, 1)),
    to: toIsoEndOfDay(new Date(currentYear, toMonth + 1, 0)),
  };
}
