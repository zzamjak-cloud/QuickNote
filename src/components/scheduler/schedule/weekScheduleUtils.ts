// 주간/월간 스케줄 뷰에서 사용하는 유틸리티 함수 및 타입 정의

import {
  addDays,
  startOfDay,
  startOfWeek,
  toIsoEndOfDay,
  toIsoStartOfDay,
} from '../../../lib/scheduler/dateUtils'
import type { Schedule } from '../../../store/schedulerStore'

// date-fns 미설치 → 인라인 날짜 유틸
export function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7)
}

export function subDays(d: Date, n: number): Date {
  return addDays(d, -n)
}

export function differenceInCalendarDays(a: Date, b: Date): number {
  const msPerDay = 86400000
  return Math.floor((startOfDay(a).getTime() - startOfDay(b).getTime()) / msPerDay)
}

export const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

/** M/d 형식 포맷 */
export function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** EEE (요일 약자) 한국어 */
export function fmtDow(d: Date): string {
  return DOW_KO[d.getDay()] ?? ''
}

// 근태 일정 판별 — 근태 속성에서 투영된 kind 기준
export function isAnnualLeaveSchedule(s: Schedule): boolean {
  return s.kind === 'leave'
}

// Project 호환 타입 (조직·팀을 통합)
export type ProjectMeta = {
  id: string
  name: string
  type: 'organization' | 'team' | 'project'
}

export const PAST_WEEK_GRAY = '#9ca3af'

// 주간 보기: 3주 × 7일(월~일)
export const WEEK_SLOT_COUNT = 21
export const WEEK_HEADER_HEIGHT = 76
export const WEEK_CARD_MARGIN = 2
export const TIMELINE_BOTTOM_SPACER_HEIGHT = 240
export const MEMBER_COLUMN_WIDTH = 120

// Schedule 은 ISO 문자열 기반 → ms 변환 헬퍼
export function scheduleStartMs(s: Schedule): number {
  return new Date(s.startAt).getTime()
}
export function scheduleEndMs(s: Schedule): number {
  return new Date(s.endAt).getTime()
}

/** 일정 [start, end) 와 달력 하루(00:00~다음날 00:00) 겹침 */
export function overlapsDay(s: Schedule, day: Date): boolean {
  const dayStart = startOfDay(day).getTime()
  const dayEndEx = addDays(startOfDay(day), 1).getTime()
  return scheduleStartMs(s) < dayEndEx && scheduleEndMs(s) > dayStart
}

export type WeekDaySlot = {
  weekIndex: 0 | 1 | 2
  dow: number
  date: Date
  weekBoundaryBefore?: boolean
}

export type ScheduleWeekLayout = {
  schedule: Schedule
  startSlot: number
  endSlot: number
}

export type MemberRowItem = {
  member: import('../../../store/memberStore').Member
  memberSchedules: Schedule[]
  layouts: ScheduleWeekLayout[]
  rowCount: number
  rowHeight: number
  slotHeight: number
  top: number
  cardRows: number
  canRemove: boolean
}

export type TooltipPos = { top: number; left: number; placement?: 'above' | 'below' }

export function buildWeekDaySlots(
  lastMonday: Date,
  thisMonday: Date,
  nextMonday: Date
): WeekDaySlot[] {
  const blocks = [lastMonday, thisMonday, nextMonday] as const
  const slots: WeekDaySlot[] = []
  blocks.forEach((monday, weekIndex) => {
    const base = startOfDay(monday)
    for (let dow = 0; dow < 7; dow++) {
      slots.push({
        weekIndex: weekIndex as 0 | 1 | 2,
        dow,
        date: addDays(base, dow),
      })
    }
  })
  return slots
}

export function buildMonthDaySlots(year: number, monthIndex: number): WeekDaySlot[] {
  const monthStart = startOfDay(new Date(year, monthIndex, 1))
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const slots: WeekDaySlot[] = []
  let previousWeekStart = ''

  for (let day = 0; day < days; day += 1) {
    const date = addDays(monthStart, day)
    const dayOfWeek = date.getDay()

    const weekStartKey = startOfWeek(date).toISOString()
    slots.push({
      weekIndex: 1,
      dow: dayOfWeek,
      date,
      weekBoundaryBefore: slots.length > 0 && weekStartKey !== previousWeekStart,
    })
    previousWeekStart = weekStartKey
  }

  return slots
}

export function relativeWeekTitle(offset: number): string {
  if (offset === -1) return '지난주'
  if (offset === 0) return '이번주'
  if (offset === 1) return '다음주'
  return offset < -1 ? '과거' : '미래'
}

export function scheduleOverlapsAnyDaySlot(s: Schedule, slots: WeekDaySlot[]): boolean {
  return slots.some((slot) => overlapsDay(s, slot.date))
}

export function getScheduleSlotRange(s: Schedule, slots: WeekDaySlot[]): ScheduleWeekLayout | null {
  let startSlot = -1
  let endSlot = -1
  slots.forEach((slot, index) => {
    if (!overlapsDay(s, slot.date)) return
    if (startSlot < 0) startSlot = index
    endSlot = index
  })
  if (startSlot < 0 || endSlot < 0) return null
  return { schedule: s, startSlot, endSlot }
}

// 프로젝트 메타 인라인 헬퍼
export function getScheduleScopeMeta(
  schedule: Schedule,
  scopes: ProjectMeta[]
): { displayText: string; tooltip: string } {
  const project = schedule.projectId
    ? scopes.find((x) => x.type === 'project' && x.id === schedule.projectId)
    : null
  if (project) {
    return { displayText: project.name, tooltip: project.name }
  }

  const team = schedule.teamId
    ? scopes.find((x) => x.type === 'team' && x.id === schedule.teamId)
    : null
  if (team) {
    return { displayText: team.name, tooltip: team.name }
  }

  const organization = schedule.organizationId
    ? scopes.find((x) => x.type === 'organization' && x.id === schedule.organizationId)
    : null
  if (organization) {
    return { displayText: organization.name, tooltip: organization.name }
  }

  return { displayText: '기타 업무', tooltip: '기타 업무' }
}

export function slotRangeToIso(slots: WeekDaySlot[], startSlot: number, endSlot: number): { startAt: string; endAt: string } {
  return {
    startAt: toIsoStartOfDay(slots[startSlot]!.date),
    endAt: toIsoEndOfDay(slots[endSlot]!.date),
  }
}

export function clampSlotStart(startSlot: number, span: number, slotCount: number): number {
  return Math.max(0, Math.min(slotCount - span, startSlot))
}
