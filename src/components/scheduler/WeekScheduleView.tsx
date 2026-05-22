// 주간/월간 보기 — ScheduleRangeView 를 감싸는 thin 래퍼

import { ScheduleRangeView } from './schedule/ScheduleRangeView'

export function WeekScheduleView() {
  return <ScheduleRangeView mode="week" />
}

export function MonthScheduleView() {
  return <ScheduleRangeView mode="month" />
}
