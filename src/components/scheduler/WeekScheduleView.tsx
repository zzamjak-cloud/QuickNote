// 주간 보기 — 지난주·이번주·다음주 × 평일 5일(월~금), 주 단위로만 카드 분할·주 내에서는 연결

import { useMemo, useState } from 'react'
import {
  addDays,
  startOfDay,
  isSameDay,
  startOfWeek,
} from '../../lib/scheduler/dateUtils'
import { useSchedulerStore, type Schedule } from '../../store/schedulerStore'
import { useSchedulerViewStore } from '../../store/schedulerViewStore'
import { useOrganizationStore } from '../../store/organizationStore'
import { useTeamStore } from '../../store/teamStore'
import { useSchedulerHolidaysStore } from '../../store/schedulerHolidaysStore'
import { useVisibleMembers } from './hooks/useVisibleMembers'
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR } from '../../lib/scheduler/colors'
import { ScheduleEditPopup } from './ScheduleEditPopup'
import type { Member } from '../../store/memberStore'
import { getHolidaysForYear } from '../../lib/scheduler/koreanHolidays'
import { LC_SCHEDULER_WORKSPACE_ID } from '../../lib/scheduler/scope'
import { useWorkspaceStore } from '../../store/workspaceStore'

// date-fns 미설치 → 인라인 날짜 유틸
function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7)
}

function subDays(d: Date, n: number): Date {
  return addDays(d, -n)
}

function differenceInCalendarDays(a: Date, b: Date): number {
  const msPerDay = 86400000
  return Math.floor((startOfDay(a).getTime() - startOfDay(b).getTime()) / msPerDay)
}

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

/** M/d 형식 포맷 */
function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** EEE (요일 약자) 한국어 */
function fmtDow(d: Date): string {
  return DOW_KO[d.getDay()] ?? ''
}

// 연차 일정 판별 — 색상으로 구분
function isAnnualLeaveSchedule(s: Schedule): boolean {
  return s.color === ANNUAL_LEAVE_COLOR
}

// Project 호환 타입 (조직·팀을 통합)
type ProjectMeta = {
  id: string
  name: string
  type: 'organization' | 'project'
}

const COL_BG = ['#9ca3af', '#3b82f6', '#1e3a8a'] as const
const PAST_WEEK_GRAY = '#9ca3af'

function darkenHexColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex
  const n = parseInt(clean, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const nr = Math.max(0, Math.round(r * (1 - amount)))
  const ng = Math.max(0, Math.round(g * (1 - amount)))
  const nb = Math.max(0, Math.round(b * (1 - amount)))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

const GRID_15 = { gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' } as const

// Schedule 은 ISO 문자열 기반 → ms 변환 헬퍼
function scheduleStartMs(s: Schedule): number {
  return new Date(s.startAt).getTime()
}
function scheduleEndMs(s: Schedule): number {
  return new Date(s.endAt).getTime()
}

/** 일정 [start, end) 와 달력 하루(00:00~다음날 00:00) 겹침 */
function overlapsDay(s: Schedule, day: Date): boolean {
  const dayStart = startOfDay(day).getTime()
  const dayEndEx = addDays(startOfDay(day), 1).getTime()
  return scheduleStartMs(s) < dayEndEx && scheduleEndMs(s) > dayStart
}

function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatScheduleRange(s: Schedule): string {
  const start = startOfDay(new Date(scheduleStartMs(s)))
  const endExclusive = startOfDay(new Date(scheduleEndMs(s)))
  const endInclusive = subDays(endExclusive, 1)
  if (endInclusive < start) {
    return fmtMD(start)
  }
  if (fmtYMD(start) === fmtYMD(endInclusive)) {
    return fmtMD(start)
  }
  return `${fmtMD(start)} ~ ${fmtMD(endInclusive)}`
}

type WeekDaySlot = {
  weekIndex: 0 | 1 | 2
  dow: number
  date: Date
}

/** 한 주(월~금) 안에서 일정이 덮는 연속 구간(주 경계에서만 분할) */
type WeekFragment = {
  weekIndex: 0 | 1 | 2
  minD: number
  maxD: number
}

type ScheduleWeekLayout = {
  schedule: Schedule
  fragments: WeekFragment[]
  intervals: Array<{ start: number; end: number }>
  firstStart: number
}

type ProjectPackedGroup = {
  key: string
  rows: ScheduleWeekLayout[][]
  groupStart: number
}

type MemberWeeklyStat = {
  label: string
  percent: number
}

function buildWeekDaySlots(
  lastMonday: Date,
  thisMonday: Date,
  nextMonday: Date
): WeekDaySlot[] {
  const blocks = [lastMonday, thisMonday, nextMonday] as const
  const slots: WeekDaySlot[] = []
  blocks.forEach((monday, weekIndex) => {
    const base = startOfDay(monday)
    for (let dow = 0; dow < 5; dow++) {
      slots.push({
        weekIndex: weekIndex as 0 | 1 | 2,
        dow,
        date: addDays(base, dow),
      })
    }
  })
  return slots
}

/** 15칸 그리드에서 1-based 시작 열과 span (한 주 안 연속) */
function getScheduleWeekFragments(
  s: Schedule,
  weekMondays: readonly [Date, Date, Date]
): WeekFragment[] {
  const out: WeekFragment[] = []
  for (let wi = 0; wi < 3; wi++) {
    const mon = startOfDay(weekMondays[wi]!)
    const hits: boolean[] = []
    for (let dow = 0; dow < 5; dow++) {
      hits.push(overlapsDay(s, addDays(mon, dow)))
    }
    if (!hits.some(Boolean)) continue
    let d = 0
    while (d < 5) {
      if (!hits[d]) {
        d++
        continue
      }
      let e = d
      while (e < 5 && hits[e]) e++
      out.push({ weekIndex: wi as 0 | 1 | 2, minD: d, maxD: e - 1 })
      d = e
    }
  }
  return out
}

function scheduleOverlapsAnyDaySlot(s: Schedule, slots: WeekDaySlot[]): boolean {
  return slots.some((slot) => overlapsDay(s, slot.date))
}

function intervalsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start <= b.end && b.start <= a.end
}

function layoutsOverlap(a: ScheduleWeekLayout, b: ScheduleWeekLayout): boolean {
  for (const ia of a.intervals) {
    for (const ib of b.intervals) {
      if (intervalsOverlap(ia, ib)) return true
    }
  }
  return false
}

function packTetrisRows(items: ScheduleWeekLayout[]): ScheduleWeekLayout[][] {
  const rows: ScheduleWeekLayout[][] = []
  for (const item of items) {
    let placed = false
    for (const row of rows) {
      const collides = row.some((r) => layoutsOverlap(r, item))
      if (!collides) {
        row.push(item)
        placed = true
        break
      }
    }
    if (!placed) rows.push([item])
  }
  return rows
}

/** 주간 행 그룹 정렬: 프로젝트·미배정 먼저, 조직(organization)은 뒤로 */
function groupSortTier(groupKey: string, projects: ProjectMeta[]): number {
  if (groupKey === '__unassigned__') return 0
  const p = projects.find((x) => x.id === groupKey)
  if (!p) return 0
  return p.type === 'organization' ? 1 : 0
}

/**
 * 구성원 내부에서 프로젝트 단위로 먼저 분리한 뒤,
 * 각 프로젝트 그룹 안에서만 테트리스 배치.
 */
function packRowsByProject(items: ScheduleWeekLayout[], projects: ProjectMeta[]): ProjectPackedGroup[] {
  const byProject = new Map<string, ScheduleWeekLayout[]>()
  for (const item of items) {
    const key = item.schedule.projectId || '__unassigned__'
    const arr = byProject.get(key)
    if (arr) arr.push(item)
    else byProject.set(key, [item])
  }

  const groups: ProjectPackedGroup[] = []
  byProject.forEach((groupItems, key) => {
    const sorted = [...groupItems].sort((a, b) => a.firstStart - b.firstStart)
    groups.push({
      key,
      rows: packTetrisRows(sorted),
      groupStart: sorted[0]?.firstStart ?? Number.MAX_SAFE_INTEGER,
    })
  })

  // 1) 프로젝트·미배정 → 조직 순, 2) 동일 티어에서는 첫 카드 시작 위치
  groups.sort((a, b) => {
    const ta = groupSortTier(a.key, projects)
    const tb = groupSortTier(b.key, projects)
    if (ta !== tb) return ta - tb
    return a.groupStart - b.groupStart
  })
  return groups
}

function projectLabelForStats(projectId: string | null | undefined, projects: ProjectMeta[]): string {
  if (!projectId) return '미지정'
  const p = projects.find((x) => x.id === projectId)
  return p?.name?.trim() || '미지정'
}

// 프로젝트 메타 인라인 헬퍼
function getScheduleProjectMeta(
  projectId: string | null | undefined,
  projects: ProjectMeta[]
): { displayText: string; tooltip: string } {
  if (!projectId) return { displayText: '미지정', tooltip: '미지정' }
  const p = projects.find((x) => x.id === projectId)
  if (!p) return { displayText: '미지정', tooltip: '미지정' }
  return { displayText: p.name, tooltip: p.name }
}

/**
 * 지난주(월~금) 업무 비율 계산.
 * - 하루 단위 100%를 해당 일의 업무 카드 수만큼 균등 분배
 * - 연차가 포함된 날은 업무일에서 제외(분모 감소)
 * - 주간 합계는 100%가 되도록 정수 반올림 보정
 */
function buildLastWeekStats(memberSchedules: Schedule[], lastMonday: Date, projects: ProjectMeta[]): MemberWeeklyStat[] {
  const dayKeys = [0, 1, 2, 3, 4].map((d) => startOfDay(addDays(lastMonday, d)))
  const projectShares = new Map<string, number>()
  let workingDayCount = 0

  dayKeys.forEach((day) => {
    const daily = memberSchedules.filter((s) => overlapsDay(s, day))
    if (daily.length === 0) return

    if (daily.some((s) => isAnnualLeaveSchedule(s))) {
      return
    }

    const eachShare = 1 / daily.length
    daily.forEach((s) => {
      const label = projectLabelForStats(s.projectId, projects)
      projectShares.set(label, (projectShares.get(label) || 0) + eachShare)
    })
    workingDayCount += 1
  })

  if (workingDayCount === 0 || projectShares.size === 0) {
    return []
  }

  const raw = Array.from(projectShares.entries()).map(([label, shareDays]) => {
    const exact = (shareDays / workingDayCount) * 100
    const floored = Math.floor(exact)
    return {
      label,
      exact,
      floored,
      remainder: exact - floored,
    }
  })

  const allocated = raw.reduce((sum, x) => sum + x.floored, 0)
  let remain = 100 - allocated
  if (remain > 0) {
    const byRemainder = [...raw].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder
      return b.exact - a.exact
    })
    let idx = 0
    while (remain > 0 && byRemainder.length > 0) {
      byRemainder[idx % byRemainder.length]!.floored += 1
      remain -= 1
      idx += 1
    }
  }

  return raw
    .map((x) => ({ label: x.label, percent: x.floored }))
    .filter((x) => x.percent > 0)
    .sort((a, b) => b.percent - a.percent || a.label.localeCompare(b.label, 'ko'))
}

function getSafePopupPosition(x: number, y: number): { x: number; y: number } {
  const POPUP_WIDTH = 300
  const POPUP_HEIGHT = 360
  const MARGIN = 8
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  let nx = x - 170
  let ny = y - 120
  if (ny + POPUP_HEIGHT > viewportHeight) ny = y - POPUP_HEIGHT - MARGIN
  if (nx + POPUP_WIDTH > viewportWidth) nx = viewportWidth - POPUP_WIDTH - MARGIN
  if (nx < MARGIN) nx = MARGIN
  if (ny < MARGIN) ny = MARGIN
  return { x: nx, y: ny }
}

function ScheduleWeekSpanCell({
  schedule: s,
  projects,
  weekIndex,
  gridColumn,
  onOpenEdit,
  showLeftResizeHandle = false,
  showRightResizeHandle = false,
  rangeStart = 0,
  rangeEnd = 0,
  onResizeRange,
}: {
  schedule: Schedule
  projects: ProjectMeta[]
  weekIndex: 0 | 1 | 2
  gridColumn: string
  onOpenEdit: (schedule: Schedule, position: { x: number; y: number }) => void
  showLeftResizeHandle?: boolean
  showRightResizeHandle?: boolean
  rangeStart?: number
  rangeEnd?: number
  onResizeRange?: (nextStart: number, nextEnd: number) => void
}) {
  const annual = isAnnualLeaveSchedule(s)
  const scheduleColor = s.color || DEFAULT_SCHEDULE_COLOR
  const bg = annual
    ? ANNUAL_LEAVE_COLOR
    : weekIndex === 0
      ? PAST_WEEK_GRAY
      : weekIndex === 2
        ? darkenHexColor(scheduleColor, 0.2)
        : scheduleColor
  const meta = getScheduleProjectMeta(s.projectId, projects)
  const [previewInset, setPreviewInset] = useState<{ left: number; right: number }>({ left: 0, right: 0 })
  const [isPreviewResizing, setIsPreviewResizing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const beginResize = (direction: 'left' | 'right', e: React.MouseEvent) => {
    if (!onResizeRange) return
    e.preventDefault()
    e.stopPropagation()
    const rowEl = (e.currentTarget as HTMLElement).closest('.week-row-grid') as HTMLElement | null
    if (!rowEl) return
    const rect = rowEl.getBoundingClientRect()

    const calcIndex = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return Math.max(0, Math.min(14, Math.floor(ratio * 15)))
    }

    let lastClientX = e.clientX
    setIsPreviewResizing(true)
    const handleMove = (ev: MouseEvent) => {
      lastClientX = ev.clientX
      const delta = ev.clientX - e.clientX
      if (direction === 'left') {
        setPreviewInset({
          left: Math.max(-rect.width + 8, Math.min(rect.width - 8, delta)),
          right: 0,
        })
      } else {
        setPreviewInset({
          left: 0,
          right: Math.max(-rect.width + 8, Math.min(rect.width - 8, -delta)),
        })
      }
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      setIsPreviewResizing(false)
      setPreviewInset({ left: 0, right: 0 })
      const idx = calcIndex(lastClientX)
      if (direction === 'left') {
        onResizeRange(Math.min(idx, rangeEnd), rangeEnd)
      } else {
        onResizeRange(rangeStart, Math.max(idx, rangeStart))
      }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  return (
    <div
      tabIndex={0}
      role="button"
      className="relative overflow-visible min-h-full rounded px-1.5 py-0.5 text-white shadow-sm border border-white/10 flex flex-col justify-start leading-tight cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/60"
      style={{
        gridColumn,
        backgroundColor: bg,
        marginLeft: previewInset.left === 0 ? undefined : `${previewInset.left}px`,
        width:
          previewInset.left === 0 && previewInset.right === 0
            ? undefined
            : `calc(100% - ${previewInset.left}px - ${previewInset.right}px)`,
        zIndex: isPreviewResizing || isHovered ? 60 : 10,
        outline: isPreviewResizing ? '2px dashed #ef4444' : undefined,
        outlineOffset: isPreviewResizing ? '1px' : undefined,
        boxShadow: isPreviewResizing ? '0 0 0 2px rgba(239,68,68,0.25)' : undefined,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={(e) => {
        onOpenEdit(s, { x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const target = e.currentTarget.getBoundingClientRect()
          onOpenEdit(s, { x: target.left + target.width / 2, y: target.top + target.height / 2 })
        }
      }}
    >
      {showLeftResizeHandle && (
        <button
          type="button"
          aria-label="시작일 조정"
          onMouseDown={(e) => beginResize('left', e)}
          className="absolute left-0 top-0 h-full w-3 z-30 cursor-ew-resize bg-white/45 opacity-0 hover:opacity-100 transition-opacity"
        />
      )}
      {showRightResizeHandle && (
        <button
          type="button"
          aria-label="종료일 조정"
          onMouseDown={(e) => beginResize('right', e)}
          className="absolute right-0 top-0 h-full w-3 z-30 cursor-ew-resize bg-white/45 opacity-0 hover:opacity-100 transition-opacity"
        />
      )}
      <div
        className="flex items-center gap-1 flex-wrap mb-0.5 min-w-0"
        title={meta.tooltip || meta.displayText || undefined}
      >
        <span
          className="text-[9px] font-semibold shrink-0 rounded px-1 py-px bg-slate-300/90 text-slate-800"
          title={meta.tooltip || meta.displayText}
        >
          {meta.displayText}
        </span>
      </div>
      <div className="text-[11px] font-semibold line-clamp-2">{annual ? s.title || '연차' : s.title}</div>
      <div className="text-[10px] opacity-90 tabular-nums mt-px">{formatScheduleRange(s)}</div>
    </div>
  )
}

export function WeekScheduleView() {
  const schedules = useSchedulerStore((s) => s.schedules)
  const { updateSchedule } = useSchedulerStore()
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId)
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId)
  const multiSelectedIds = useSchedulerViewStore((s) => s.multiSelectedIds)
  const weekendColor = useSchedulerViewStore((s) => s.weekendColor)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const visibleMembers = useVisibleMembers()

  const organizations = useOrganizationStore((s) => s.organizations)
  const teams = useTeamStore((s) => s.teams)

  // 조직·팀을 Project 호환 타입으로 변환
  const projects = useMemo<ProjectMeta[]>(() => {
    const orgs: ProjectMeta[] = organizations.map((o) => ({
      id: `org:${o.organizationId}`,
      name: o.name,
      type: 'organization',
    }))
    const tms: ProjectMeta[] = teams.map((t) => ({
      id: `team:${t.teamId}`,
      name: t.name,
      type: 'project',
    }))
    return [...orgs, ...tms]
  }, [organizations, teams])

  const workspaceId = currentWorkspaceId ?? LC_SCHEDULER_WORKSPACE_ID

  // 공식 공휴일 + 사용자 등록 공휴일 합집합으로 holidayMap/holidayTimeSet 구성
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays)
  const { holidayMap, holidayTimeSet } = useMemo(() => {
    const map = new Map<number, string>()
    const timeSet = new Set<number>()
    const now = new Date()
    // 지난주~다음주 범위의 연도를 커버 (연도 경계에서 두 연도 모두 처리)
    const years = new Set([now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1])

    for (const year of years) {
      // 공식 공휴일
      for (const h of getHolidaysForYear(year)) {
        const d = startOfDay(new Date(h.date + 'T00:00:00'))
        map.set(d.getTime(), h.name)
        timeSet.add(d.getTime())
      }
    }
    // 사용자 등록 공휴일 (공식과 겹치면 공식 우선 — set에 없는 것만 추가)
    for (const h of storeHolidays) {
      const d = startOfDay(new Date(h.date + 'T00:00:00'))
      if (!map.has(d.getTime())) {
        map.set(d.getTime(), h.title)
        timeSet.add(d.getTime())
      }
    }
    return { holidayMap: map, holidayTimeSet: timeSet }
  }, [storeHolidays])

  const [editState, setEditState] = useState<{ schedule: Schedule; x: number; y: number } | null>(null)
  const [newScheduleState, setNewScheduleState] = useState<{
    defaultStartAt: string
    defaultEndAt: string
    x: number
    y: number
    assigneeId: string
  } | null>(null)

  const { slots, weekBlocks, mondays } = useMemo(() => {
    const now = new Date()
    const thisWeekStart = startOfWeek(now)
    const lastWeekStart = subDays(thisWeekStart, 7)
    const nextWeekStart = addWeeks(thisWeekStart, 1)

    const mondays = [
      startOfDay(lastWeekStart),
      startOfDay(thisWeekStart),
      startOfDay(nextWeekStart),
    ] as const

    const slots = buildWeekDaySlots(mondays[0], mondays[1], mondays[2])

    const titles = ['지난주', '이번주', '다음주'] as const
    const weekBlocks = mondays.map((mon, wi) => {
      const fri = addDays(mon, 4)
      return {
        key: titles[wi],
        title: titles[wi],
        subtitle: `${fmtMD(mon)} – ${fmtMD(fri)} (월–금)`,
        weekIndex: wi as 0 | 1 | 2,
      }
    })

    return { slots, weekBlocks, mondays }
  }, [])

  const todaySlotIndex = useMemo(() => {
    const today = startOfDay(new Date())
    const idx = slots.findIndex((slot) => isSameDay(slot.date, today))
    if (idx >= 0) return idx

    // 주말(토/일)은 월~금 뷰에 없으므로 같은 주의 금요일 칸에 라인 표시
    const thisMonday = startOfWeek(today)
    const weekIdx = mondays.findIndex((m) => isSameDay(m, thisMonday))
    if (weekIdx >= 0) {
      return weekIdx * 5 + 4
    }

    // 안전장치: 오늘이 3주 범위를 벗어나면 라인 숨김
    const from = mondays[0]
    const to = addDays(mondays[2], 6)
    const outOfRange = differenceInCalendarDays(today, from) < 0 || differenceInCalendarDays(today, to) > 0
    return outOfRange ? null : 4
  }, [slots, mondays])

  const getSlotBackground = (slot: WeekDaySlot, alphaHex: string): string => {
    const key = startOfDay(slot.date).getTime()
    if (holidayTimeSet.has(key)) {
      // 공휴일은 weekendColor 원색 사용
      return weekendColor
    }
    return `${COL_BG[slot.weekIndex]}${alphaHex}`
  }

  // 멤버별 일정 맵 (assigneeId 기준)
  const schedulesByMemberId = useMemo(() => {
    const map: Record<string, Schedule[]> = {}
    for (const s of schedules) {
      const key = s.assigneeId ?? '__none__'
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [schedules])

  // selectedMemberId · multiSelectedIds 필터 적용
  const filteredMembers = useMemo<Member[]>(() => {
    if (multiSelectedIds.length > 0) {
      return visibleMembers.filter((m) => multiSelectedIds.includes(m.memberId))
    }
    if (selectedMemberId) {
      return visibleMembers.filter((m) => m.memberId === selectedMemberId)
    }
    return visibleMembers
  }, [visibleMembers, selectedMemberId, multiSelectedIds])

  // selectedProjectId 가 있으면 해당 프로젝트 일정만 표시 (멤버 필터는 useVisibleMembers 가 처리)
  const effectiveSelectedProjectId =
    selectedProjectId?.startsWith('proj:') ? selectedProjectId.slice(5) : null

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-auto bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      {/* 헤더: 3주 × 5일 */}
      <div className="shrink-0 sticky top-0 z-20 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={GRID_15}>
            {weekBlocks.map((block) => (
              <div
                key={block.key}
                className="col-span-5 text-center py-1.5 border-r border-zinc-200 dark:border-zinc-800 last:border-r-0"
                style={{ borderTop: `3px solid ${COL_BG[block.weekIndex]}` }}
              >
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{block.title}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-tight px-1">{block.subtitle}</div>
              </div>
            ))}
          </div>
          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={GRID_15}>
            {slots.map((slot, i) => {
              const holidayText = holidayMap.get(startOfDay(slot.date).getTime())
              return (
                <div
                  key={`${slot.date.getTime()}-${i}`}
                  className="text-[10px] text-center py-1 border-r border-zinc-200/60 dark:border-zinc-800/60 last:border-r-0 text-zinc-500 dark:text-zinc-400 leading-tight"
                  style={{ backgroundColor: getSlotBackground(slot, '0f') }}
                  title={holidayText || undefined}
                >
                  <div className="font-medium text-zinc-900/80 dark:text-zinc-100/80">{fmtDow(slot.date)}</div>
                  <div className="tabular-nums">{fmtMD(slot.date)}</div>
                  {holidayText ? (
                    <div className="text-[9px] leading-tight mt-0.5 text-zinc-900/85 dark:text-zinc-100/85 truncate px-0.5">
                      {holidayText}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          {todaySlotIndex !== null && (
            <div
              className="absolute top-0 bottom-0 bg-blue-500 z-20 pointer-events-none"
              style={{
                left: `calc(${(todaySlotIndex / 15) * 100}% + (100% / 15 / 2) - 2px)`,
                width: 4,
                boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)',
              }}
            />
          )}
        </div>
      </div>

      <div className="relative">
        {todaySlotIndex !== null && (
          <div
            className="absolute top-0 bottom-0 bg-blue-500 z-20 pointer-events-none"
            style={{
              left: `calc(${(todaySlotIndex / 15) * 100}% + (100% / 15 / 2) - 2px)`,
              width: 4,
              boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)',
            }}
          />
        )}
        {filteredMembers.map((m) => {
          const allMember = schedulesByMemberId[m.memberId] || []
          // projectId 필터: selectedProjectId 가 있으면 해당 프로젝트 일정만
          const raw = effectiveSelectedProjectId
            ? allMember.filter((s) => s.projectId === effectiveSelectedProjectId)
            : allMember
          const lastWeekStats = buildLastWeekStats(raw, mondays[0], projects)
          const lastWeekStatsText =
            lastWeekStats.length > 0
              ? lastWeekStats.map((s) => `${s.label} ${s.percent}%`).join(' / ')
              : '지난주 업무 없음'
          const memberSchedules = [...raw]
            .filter((s) => scheduleOverlapsAnyDaySlot(s, slots))
            .sort((a, b) => scheduleStartMs(a) - scheduleStartMs(b))

          const scheduleLayouts = memberSchedules
            .map((s) => {
              const fragments = getScheduleWeekFragments(s, mondays)
              if (fragments.length === 0) return null
              const intervals = fragments.map((fr) => ({
                start: fr.weekIndex * 5 + fr.minD,
                end: fr.weekIndex * 5 + fr.maxD,
              }))
              const firstStart = Math.min(...intervals.map((x) => x.start))
              return { schedule: s, fragments, intervals, firstStart }
            })
            .filter((x): x is ScheduleWeekLayout => x !== null)

          const packedGroups = packRowsByProject(scheduleLayouts, projects)

          return (
            <div key={m.memberId} className="mb-4 border border-zinc-200/70 dark:border-zinc-800/70 rounded-sm bg-white dark:bg-zinc-900 relative">
              {/* 구성원 헤더: 병합 셀 대신 15칸 배경 + 태그 오버레이 */}
              <div className="relative min-h-[30px]">
                <div className="absolute inset-0 grid pointer-events-none" style={GRID_15}>
                  {slots.map((slot, i) => (
                    <div
                      key={`head-bg-${m.memberId}-${i}`}
                      className="border-r border-zinc-200/40 dark:border-zinc-800/40 last:border-r-0"
                      style={{ backgroundColor: getSlotBackground(slot, '14') }}
                    />
                  ))}
                </div>
                <div className="relative z-10 grid min-h-[30px]" style={GRID_15}>
                  <div className="col-span-5 flex items-center justify-center px-2">
                    <span className="max-w-full truncate rounded-md bg-zinc-50/85 dark:bg-zinc-950/85 border border-zinc-200/70 dark:border-zinc-800/70 px-2 py-0.5 text-[10px] font-medium text-zinc-900 dark:text-zinc-100" title={lastWeekStatsText}>
                      {lastWeekStatsText}
                    </span>
                  </div>
                  <div className="col-span-5 flex items-center justify-center px-2 gap-1.5">
                    <span className="max-w-[70%] truncate rounded-md bg-zinc-50/90 dark:bg-zinc-950/90 border border-zinc-200/80 dark:border-zinc-800/80 px-2 py-0.5 text-[12px] font-semibold text-zinc-900 dark:text-zinc-100" title={m.name}>
                      {m.name}
                    </span>
                    <button
                      type="button"
                      className="text-[10px] px-2 py-0.5 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => {
                        if (!workspaceId) return
                        const startAt = startOfDay(mondays[1]).toISOString()
                        const endAt = addDays(startOfDay(mondays[1]), 5).toISOString()
                        setNewScheduleState({
                          defaultStartAt: startAt,
                          defaultEndAt: endAt,
                          assigneeId: m.memberId,
                          ...getSafePopupPosition(window.innerWidth * 0.55, window.innerHeight * 0.35),
                        })
                      }}
                      title={`이번주에 ${m.name} 일정 추가`}
                    >
                      + 일정추가
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-200/70 dark:border-zinc-800/70 items-start">
                <div className="min-w-0 relative self-stretch min-h-[34px]">
                  <div className="absolute inset-0 grid pointer-events-none" style={GRID_15}>
                    {slots.map((slot, i) => (
                      <div
                        key={`bg-${m.memberId}-${i}`}
                        className="border-r border-zinc-200/40 dark:border-zinc-800/40 last:border-r-0"
                        style={{ backgroundColor: getSlotBackground(slot, '14') }}
                      />
                    ))}
                  </div>
                  <div className="relative z-10 flex flex-col gap-0 p-1">
                    {packedGroups.length === 0 ? (
                      <div className="grid w-full min-h-[28px] items-center" style={GRID_15}>
                        <div className="col-span-15 text-[11px] text-center text-zinc-500 dark:text-zinc-400 py-1">
                          표시할 업무가 없습니다.
                        </div>
                      </div>
                    ) : (
                      packedGroups.map((group, groupIdx) => (
                        <div
                          key={`${m.memberId}-group-${group.key}-${groupIdx}`}
                          className={groupIdx > 0 ? 'mt-1 pt-1 border-t border-zinc-200/40 dark:border-zinc-800/40' : ''}
                        >
                          {group.rows.map((row, rowIdx) => (
                            <div
                              key={`${m.memberId}-group-${group.key}-row-${rowIdx}`}
                              className="week-row-grid grid w-full items-stretch min-h-[28px] [&:not(:last-child)]:border-b border-zinc-200/40 dark:border-zinc-800/40"
                              style={GRID_15}
                            >
                              {row.map((item) =>
                                item.fragments.map((fr, fi) => {
                                  const startCol = fr.weekIndex * 5 + fr.minD + 1
                                  const span = fr.maxD - fr.minD + 1
                                  const gridColumn = `${startCol} / span ${span}`
                                  const rangeStart = Math.min(...item.intervals.map((x) => x.start))
                                  const rangeEnd = Math.max(...item.intervals.map((x) => x.end))
                                  return (
                                    <ScheduleWeekSpanCell
                                      key={`${item.schedule.id}-w${fr.weekIndex}-${fr.minD}-${fr.maxD}-${fi}`}
                                      schedule={item.schedule}
                                      projects={projects}
                                      weekIndex={fr.weekIndex}
                                      gridColumn={gridColumn}
                                      showLeftResizeHandle={fr.weekIndex * 5 + fr.minD === rangeStart}
                                      showRightResizeHandle={fr.weekIndex * 5 + fr.maxD === rangeEnd}
                                      rangeStart={rangeStart}
                                      rangeEnd={rangeEnd}
                                      onResizeRange={async (nextStart, nextEnd) => {
                                        if (!workspaceId) return
                                        const newStartAt = startOfDay(slots[nextStart]!.date).toISOString()
                                        const newEndAt = addDays(startOfDay(slots[nextEnd]!.date), 1).toISOString()
                                        const current = item.schedule
                                        if (newStartAt === current.startAt && newEndAt === current.endAt) return

                                        updateSchedule({
                                          id: current.id,
                                          workspaceId,
                                          startAt: newStartAt,
                                          endAt: newEndAt,
                                        }).catch((error: unknown) => {
                                          console.error('주간 보기 일정 리사이즈 실패:', error)
                                        })
                                      }}
                                      onOpenEdit={(schedule, position) =>
                                        setEditState({
                                          schedule,
                                          ...getSafePopupPosition(position.x, position.y),
                                        })
                                      }
                                    />
                                  )
                                })
                              )}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {filteredMembers.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-zinc-500 dark:text-zinc-400 text-sm p-8 min-h-[120px]">
          표시할 구성원이 없습니다. 필터를 조정해 보세요.
        </div>
      )}

      {/* 기존 일정 편집 팝업 */}
      {editState && (
        <div
          className="fixed z-50"
          style={{ left: editState.x, top: editState.y }}
        >
          <ScheduleEditPopup
            schedule={editState.schedule}
            workspaceId={workspaceId}
            onClose={() => setEditState(null)}
          />
        </div>
      )}

      {/* 신규 일정 생성 팝업 */}
      {newScheduleState && (
        <div
          className="fixed z-50"
          style={{ left: newScheduleState.x, top: newScheduleState.y }}
        >
          <ScheduleEditPopup
            schedule={null}
            defaultStartAt={newScheduleState.defaultStartAt}
            defaultEndAt={newScheduleState.defaultEndAt}
            workspaceId={workspaceId}
            onClose={() => setNewScheduleState(null)}
          />
        </div>
      )}
    </div>
  )
}
