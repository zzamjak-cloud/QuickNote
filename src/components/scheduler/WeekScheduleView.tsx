// 주간 보기 — 지난주·이번주·다음주 × 평일 5일(월~금), 주 단위로만 카드 분할·주 내에서는 연결

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Rnd } from 'react-rnd'
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus } from 'lucide-react'
import {
  addDays,
  startOfDay,
  isSameDay,
  startOfWeek,
  toIsoEndOfDay,
  toIsoStartOfDay,
} from '../../lib/scheduler/dateUtils'
import { useSchedulerStore, type Schedule } from '../../store/schedulerStore'
import { useSchedulerViewStore } from '../../store/schedulerViewStore'
import { useOrganizationStore } from '../../store/organizationStore'
import { useTeamStore } from '../../store/teamStore'
import { useSchedulerHolidaysStore } from '../../store/schedulerHolidaysStore'
import { useSchedulerProjectsStore } from '../../store/schedulerProjectsStore'
import { useVisibleMembers } from './hooks/useVisibleMembers'
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR, pickTextColor } from '../../lib/scheduler/colors'
import { useMemberStore, type Member } from '../../store/memberStore'
import { getHolidaysForYear } from '../../lib/scheduler/koreanHolidays'
import { LC_SCHEDULER_WORKSPACE_ID } from '../../lib/scheduler/scope'
import { parseScheduleInstanceId } from '../../lib/scheduler/taskAdapter'
import { LC_SCHEDULER_ATTENDANCE_TITLE } from '../../lib/scheduler/database'
import { useUiStore } from '../../store/uiStore'
import { computeRowCount, hasCollision } from '../../lib/scheduler/collisionDetection'
import { ContextMenu } from './ContextMenu'
import { updateMemberApi } from '../../lib/sync/memberApi'
import { getRowHeight } from '../../lib/scheduler/grid'
import { groupSchedulesByMember } from '../../lib/scheduler/selectors/scheduleSelectors'
import { parseDateKey } from '../../lib/scheduler/mm/weekUtils'

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

// 근태 일정 판별 — 근태 속성에서 투영된 kind 기준
function isAnnualLeaveSchedule(s: Schedule): boolean {
  return s.kind === 'leave'
}

// Project 호환 타입 (조직·팀을 통합)
type ProjectMeta = {
  id: string
  name: string
  type: 'organization' | 'team' | 'project'
}

const PAST_WEEK_GRAY = '#9ca3af'

const WEEK_SLOT_COUNT = 15
const WEEK_HEADER_HEIGHT = 76
const WEEK_CARD_MARGIN = 2
const TIMELINE_BOTTOM_SPACER_HEIGHT = 240
const MARQUEE_ACTIVATE_PX = 4
const PENDING_SCHEDULE_PAGE_ID_PREFIX = 'lc-scheduler:creating:'
const MEMBER_COLUMN_WIDTH = 120

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

type WeekDaySlot = {
  weekIndex: 0 | 1 | 2
  dow: number
  date: Date
  weekBoundaryBefore?: boolean
}

type ScheduleWeekLayout = {
  schedule: Schedule
  startSlot: number
  endSlot: number
}

type BoxSelectionRect = {
  startX: number
  startY: number
  endX: number
  endY: number
}

type MousePointEvent = Pick<MouseEvent, 'clientX' | 'clientY'> | React.MouseEvent

type MemberRowItem = {
  member: Member
  memberSchedules: Schedule[]
  layouts: ScheduleWeekLayout[]
  rowCount: number
  rowHeight: number
  slotHeight: number
  top: number
  cardRows: number
  canRemove: boolean
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

function buildMonthWorkdaySlots(year: number, monthIndex: number): WeekDaySlot[] {
  const monthStart = startOfDay(new Date(year, monthIndex, 1))
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const slots: WeekDaySlot[] = []
  let previousWeekStart = ''

  for (let day = 0; day < days; day += 1) {
    const date = addDays(monthStart, day)
    const dayOfWeek = date.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

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

function relativeWeekTitle(offset: number): string {
  if (offset === -1) return '지난주'
  if (offset === 0) return '이번주'
  if (offset === 1) return '다음주'
  return offset < -1 ? '과거' : '미래'
}

function scheduleOverlapsAnyDaySlot(s: Schedule, slots: WeekDaySlot[]): boolean {
  return slots.some((slot) => overlapsDay(s, slot.date))
}

function getScheduleSlotRange(s: Schedule, slots: WeekDaySlot[]): ScheduleWeekLayout | null {
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

function rectsIntersect(
  selLeft: number,
  selRight: number,
  selTop: number,
  selBottom: number,
  cardLeft: number,
  cardRight: number,
  cardTop: number,
  cardBottom: number,
): boolean {
  return cardLeft < selRight && cardRight > selLeft && cardTop < selBottom && cardBottom > selTop
}

// 프로젝트 메타 인라인 헬퍼
function getScheduleScopeMeta(
  schedule: Schedule,
  scopes: ProjectMeta[]
): { displayText: string; tooltip: string } {
  const project = schedule.projectId
    ? scopes.find((x) => x.type === 'project' && x.id === schedule.projectId)
    : null
  if (project) {
    return { displayText: `프로젝트 · ${project.name}`, tooltip: project.name }
  }

  const team = schedule.teamId
    ? scopes.find((x) => x.type === 'team' && x.id === schedule.teamId)
    : null
  if (team) {
    return { displayText: `팀 · ${team.name}`, tooltip: team.name }
  }

  const organization = schedule.organizationId
    ? scopes.find((x) => x.type === 'organization' && x.id === schedule.organizationId)
    : null
  if (organization) {
    return { displayText: `조직 · ${organization.name}`, tooltip: organization.name }
  }

  return { displayText: '기타 업무', tooltip: '기타 업무' }
}

type TooltipPos = { top: number; left: number; placement?: 'above' | 'below' }

function slotRangeToIso(slots: WeekDaySlot[], startSlot: number, endSlot: number): { startAt: string; endAt: string } {
  return {
    startAt: toIsoStartOfDay(slots[startSlot]!.date),
    endAt: toIsoEndOfDay(slots[endSlot]!.date),
  }
}

function clampSlotStart(startSlot: number, span: number, slotCount: number): number {
  return Math.max(0, Math.min(slotCount - span, startSlot))
}

function ScheduleWeekCard({
  schedule: s,
  projects,
  members,
  slots,
  startSlot,
  endSlot,
  slotCount,
  cellWidth,
  slotHeight,
  rowCount,
  allSchedules,
  isSelected,
  isMultiSelected,
  multiDragDeltaX,
  multiDragDeltaY,
  onSelect,
  onOpenPage,
  onUpdate,
  onCreate,
  onMultiDragStart,
  onMultiDragMove,
  onMultiDragEnd,
}: {
  schedule: Schedule
  projects: ProjectMeta[]
  members: Member[]
  slots: WeekDaySlot[]
  startSlot: number
  endSlot: number
  slotCount: number
  cellWidth: number
  slotHeight: number
  rowCount: number
  allSchedules: Schedule[]
  isSelected: boolean
  isMultiSelected?: boolean
  multiDragDeltaX?: number | null
  multiDragDeltaY?: number | null
  onSelect: (id: string) => void
  onOpenPage: (id: string) => void
  onUpdate: ReturnType<typeof useSchedulerStore.getState>['updateSchedule']
  onCreate: ReturnType<typeof useSchedulerStore.getState>['createSchedule']
  onMultiDragStart?: () => void
  onMultiDragMove?: (deltaX: number, deltaY: number) => void
  onMultiDragEnd?: (deltaX: number, deltaY: number) => void
}) {
  const annual = isAnnualLeaveSchedule(s)
  const scheduleColor = s.color || DEFAULT_SCHEDULE_COLOR
  const isPast = !annual && new Date(s.endAt).getTime() < Date.now()
  const bg = annual
    ? ANNUAL_LEAVE_COLOR
    : isPast
      ? PAST_WEEK_GRAY
      : scheduleColor
  const textColor = s.textColor ?? '#ffffff'
  const meta = getScheduleScopeMeta(s, projects)
  const span = Math.max(1, endSlot - startSlot + 1)
  const x = startSlot * cellWidth
  const w = span * cellWidth
  const rowIdx = Math.max(0, Math.min(rowCount - 1, s.rowIndex ?? 0))
  const y = rowIdx * slotHeight
  const rndRef = useRef<Rnd>(null)
  const dragMovedRef = useRef(false)
  const isShiftDragRef = useRef(false)
  const isMultiDragRef = useRef(false)
  const resizeStartRef = useRef<{ startSlot: number; endSlot: number } | null>(null)
  const [localX, setLocalX] = useState(x)
  const [localW, setLocalW] = useState(w)
  const [localY, setLocalY] = useState(y)
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<TooltipPos | null>(null)

  useLayoutEffect(() => {
    setLocalX(x)
    setLocalW(w)
    setLocalY(y)
  }, [s.id, x, w, y])

  const findAvailableRowIndex = useCallback(
    (startAt: string, endAt: string, preferredRowIndex: number) => {
      const tryRow = (rowIndex: number) => {
        const candidate: Schedule = {
          ...s,
          startAt,
          endAt,
          rowIndex,
        }
        return !hasCollision(candidate, allSchedules)
      }

      if (tryRow(preferredRowIndex)) return preferredRowIndex
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        if (rowIndex === preferredRowIndex) continue
        if (tryRow(rowIndex)) return rowIndex
      }
      return null
    },
    [allSchedules, rowCount, s],
  )

  const handleMouseEnter = useCallback(() => {
    const el = rndRef.current?.getSelfElement()
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 6
    const placement = rect.top > 96 ? 'above' : 'below'
    setTooltipPos({
      top: placement === 'above' ? rect.top - gap : rect.bottom + gap,
      left: rect.left,
      placement,
    })
  }, [])

  const handleDragStart = useCallback((e: unknown) => {
    dragMovedRef.current = false
    isMultiDragRef.current = Boolean(isMultiSelected)
    setTooltipPos(null)
    setContextMenuPos(null)
    if (typeof e === 'object' && e && 'shiftKey' in e) {
      isShiftDragRef.current = Boolean((e as { shiftKey?: boolean }).shiftKey)
    }
    if (isMultiSelected) {
      onMultiDragStart?.()
    }
  }, [isMultiSelected, onMultiDragStart])

  const handleDrag = useCallback((_e: unknown, data: { x: number; y: number }) => {
    dragMovedRef.current = true
    if (isMultiDragRef.current) {
      const adjustedX = data.x - WEEK_CARD_MARGIN
      const adjustedY = data.y - WEEK_CARD_MARGIN
      onMultiDragMove?.(adjustedX - x, adjustedY - y)
      return
    }
    setLocalX(data.x - WEEK_CARD_MARGIN)
    setLocalY(data.y - WEEK_CARD_MARGIN)
  }, [onMultiDragMove, x, y])

  const handleDragStop = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      if (!dragMovedRef.current) {
        onSelect(s.id)
        return
      }
      if (isMultiDragRef.current) {
        isMultiDragRef.current = false
        onMultiDragEnd?.(multiDragDeltaX ?? 0, multiDragDeltaY ?? 0)
        return
      }

      const wasShiftDrag = isShiftDragRef.current
      isShiftDragRef.current = false
      const adjustedX = data.x - WEEK_CARD_MARGIN
      const adjustedY = data.y - WEEK_CARD_MARGIN
      const nextStartSlot = clampSlotStart(Math.round(adjustedX / cellWidth), span, slotCount)
      const nextEndSlot = nextStartSlot + span - 1
      const preferredRowIndex = Math.max(0, Math.min(rowCount - 1, Math.round(adjustedY / slotHeight)))
      const { startAt, endAt } = slotRangeToIso(slots, nextStartSlot, nextEndSlot)
      const newRowIndex = findAvailableRowIndex(startAt, endAt, preferredRowIndex)
      if (newRowIndex == null) {
        setLocalX(x)
        setLocalY(y)
        return
      }

      const nextLocalX = nextStartSlot * cellWidth
      const nextLocalY = newRowIndex * slotHeight

      if (wasShiftDrag) {
        void onCreate({
          workspaceId: s.workspaceId,
          title: s.title,
          comment: s.comment ?? null,
          link: s.link ?? null,
          projectId: s.projectId ?? null,
          assigneeId: s.assigneeId ?? null,
          selectedScopeKey: s.projectId
            ? `proj:${s.projectId}`
            : s.teamId
              ? `team:${s.teamId}`
              : s.organizationId
                ? `org:${s.organizationId}`
                : null,
          color: s.color ?? null,
          textColor: s.textColor ?? null,
          startAt,
          endAt,
          rowIndex: newRowIndex,
        })
        setLocalX(x)
        setLocalY(y)
        return
      }

      setLocalX(nextLocalX)
      setLocalY(nextLocalY)
      void onUpdate({
        id: s.id,
        workspaceId: s.workspaceId,
        startAt,
        endAt,
        rowIndex: newRowIndex,
      }).catch(() => {
        setLocalX(x)
        setLocalY(y)
      })
    },
    [
      cellWidth,
      findAvailableRowIndex,
      multiDragDeltaX,
      multiDragDeltaY,
      onCreate,
      onMultiDragEnd,
      onSelect,
      onUpdate,
      rowCount,
      s,
      slotCount,
      slotHeight,
      slots,
      span,
      x,
      y,
    ],
  )

  const handleResizeStart = useCallback(() => {
    resizeStartRef.current = { startSlot, endSlot }
    setTooltipPos(null)
    setContextMenuPos(null)
  }, [endSlot, startSlot])

  const handleResizeStop = useCallback(
    (
      _e: unknown,
      direction: string,
      _ref: HTMLElement,
      delta: { width: number },
    ) => {
      const start = resizeStartRef.current ?? { startSlot, endSlot }
      const cellDelta = Math.round(delta.width / cellWidth)
      const nextStartSlot = direction.includes('left')
        ? Math.max(0, Math.min(start.endSlot, start.startSlot - cellDelta))
        : start.startSlot
      const nextEndSlot = direction.includes('left')
        ? start.endSlot
        : Math.max(start.startSlot, Math.min(slotCount - 1, start.endSlot + cellDelta))
      const { startAt, endAt } = slotRangeToIso(slots, nextStartSlot, nextEndSlot)
      const nextSchedule: Schedule = {
        ...s,
        startAt,
        endAt,
      }
      if (hasCollision(nextSchedule, allSchedules)) {
        setLocalX(x)
        setLocalW(w)
        resizeStartRef.current = null
        return
      }

      setLocalX(nextStartSlot * cellWidth)
      setLocalW((nextEndSlot - nextStartSlot + 1) * cellWidth)
      resizeStartRef.current = null
      void onUpdate({
        id: s.id,
        workspaceId: s.workspaceId,
        startAt,
        endAt,
      }).catch(() => {
        setLocalX(x)
        setLocalW(w)
        resizeStartRef.current = null
      })
    },
    [allSchedules, cellWidth, endSlot, onUpdate, s, slotCount, slots, startSlot, w, x],
  )

  const handleColorChange = useCallback(
    (color: string) => {
      void onUpdate({
        id: s.id,
        workspaceId: s.workspaceId,
        color,
        textColor: pickTextColor(color),
      }).catch(() => {
        window.alert('색상 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      })
    },
    [onUpdate, s.id, s.workspaceId],
  )

  const handleTransfer = useCallback(
    (targetMemberId: string) => {
      const targetSchedules = allSchedules.filter((item) => item.assigneeId === targetMemberId)
      let targetRowIndex = 0
      for (; targetRowIndex <= targetSchedules.length; targetRowIndex += 1) {
        const candidate: Schedule = {
          ...s,
          assigneeId: targetMemberId,
          rowIndex: targetRowIndex,
        }
        if (!hasCollision(candidate, allSchedules)) break
      }

      void onUpdate({
        id: s.id,
        workspaceId: s.workspaceId,
        assigneeId: targetMemberId,
        rowIndex: targetRowIndex,
      }).catch(() => {
        window.alert('업무 이관에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      })
    },
    [allSchedules, onUpdate, s],
  )

  return (
    <>
      <Rnd
        ref={rndRef}
        bounds="parent"
        dragAxis={rowCount > 1 ? 'both' : 'x'}
        dragGrid={[1, 1]}
        resizeGrid={[cellWidth, 1]}
        minWidth={Math.max(1, cellWidth - WEEK_CARD_MARGIN * 2)}
        position={{
          x: (isMultiSelected && multiDragDeltaX != null ? x + multiDragDeltaX : localX) + WEEK_CARD_MARGIN,
          y: (isMultiSelected && multiDragDeltaY != null ? y + multiDragDeltaY : localY) + WEEK_CARD_MARGIN,
        }}
        size={{
          width: Math.max(0, localW - WEEK_CARD_MARGIN * 2),
          height: Math.max(0, slotHeight - WEEK_CARD_MARGIN * 2),
        }}
        enableResizing={{ left: true, right: true, top: false, bottom: false, topLeft: false, topRight: false, bottomLeft: false, bottomRight: false }}
        resizeHandleStyles={{
          left: { cursor: 'ew-resize', width: 8, left: 0 },
          right: { cursor: 'ew-resize', width: 8, right: 0 },
        }}
        className={`schedule-card rounded-md select-none overflow-hidden border-2 transition-shadow cursor-move ${
          isSelected || isMultiSelected
            ? 'ring-2 ring-blue-500 border-white shadow-lg'
            : 'border-transparent hover:border-white/40 hover:shadow-sm'
        }`}
        style={{ position: 'absolute', zIndex: isSelected ? 40 : 20 }}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
      >
        <div
          tabIndex={0}
          role="button"
          className="w-full h-full flex items-center px-1.5 overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          style={{ backgroundColor: bg, color: textColor }}
          onMouseDown={() => {
            if (!isMultiSelected) onSelect(s.id)
          }}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(s.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onSelect(s.id)
            setContextMenuPos({ left: e.clientX, top: e.clientY })
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onOpenPage(s.id)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onOpenPage(s.id)
            }
          }}
        >
          <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
            <span className="text-[11px] font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
              {annual ? s.title || '연차' : s.title || '제목 없음'}
            </span>
            {localW >= cellWidth * 1.5 && (
              <span className="text-[10px] opacity-80 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                {meta.displayText}
              </span>
            )}
          </div>
          {s.link && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                window.open(s.link ?? '', '_blank', 'noopener,noreferrer')
              }}
              className="ml-1 p-0.5 rounded bg-black/25 hover:bg-black/35 transition-colors"
              title="링크 열기"
            >
              <ExternalLink size={10} />
            </button>
          )}
        </div>
      </Rnd>

      {tooltipPos !== null &&
        createPortal(
          <div
            className="fixed bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg px-3 py-2 z-[600] text-xs pointer-events-none"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left,
              maxWidth: 240,
              transform: tooltipPos.placement === 'above' ? 'translateY(-100%)' : undefined,
            }}
          >
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
              {meta.displayText}
            </div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
              {s.title || '제목 없음'}
            </div>
            {s.comment && (
              <div className="text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed whitespace-pre-line">
                {s.comment}
              </div>
            )}
          </div>,
          document.body,
        )}

      {contextMenuPos &&
        createPortal(
          <ContextMenu
            x={contextMenuPos.left}
            y={contextMenuPos.top}
            currentColor={bg}
            onColorChange={handleColorChange}
            members={members}
            currentMemberId={s.assigneeId ?? null}
            onTransfer={s.assigneeId ? handleTransfer : undefined}
            onClose={() => setContextMenuPos(null)}
          />,
          document.body,
        )}
    </>
  )
}

function ScheduleRangeView({ mode }: { mode: 'week' | 'month' }) {
  const schedules = useSchedulerStore((s) => s.schedules)
  const createSchedule = useSchedulerStore((s) => s.createSchedule)
  const updateSchedule = useSchedulerStore((s) => s.updateSchedule)
  const zoomLevel = useSchedulerViewStore((s) => s.zoomLevel)
  const currentYear = useSchedulerViewStore((s) => s.currentYear)
  const setCurrentYear = useSchedulerViewStore((s) => s.setCurrentYear)
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId)
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId)
  const multiSelectedIds = useSchedulerViewStore((s) => s.multiSelectedIds)
  const weekendColor = useSchedulerViewStore((s) => s.weekendColor)
  const selectedScheduleId = useSchedulerViewStore((s) => s.selectedScheduleId)
  const selectSchedule = useSchedulerViewStore((s) => s.selectSchedule)
  const mmWeekStart = useSchedulerViewStore((s) => s.mmWeekStart)
  const openPeek = useUiStore((s) => s.openPeek)
  const allMembers = useMemberStore((s) => s.members)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    kind: 'schedule' | 'leave'
    startSlot: number
    currentSlot: number
    rowTop: number
    rowHeight: number
    rowIndex: number
    assigneeId: string | null
    active: boolean
  } | null>(null)
  const [timelineWidth, setTimelineWidth] = useState(900)
  const [memberRowCounts, setMemberRowCounts] = useState<Record<string, number>>({})
  const [globalRowCount, setGlobalRowCount] = useState(1)
  const [dragState, setDragState] = useState<typeof dragRef.current>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth())
  const [pendingCreateMarquee, setPendingCreateMarquee] = useState<{
    kind: 'schedule' | 'leave'
    rowTop: number
    rowHeight: number
    startSlot: number
    endSlot: number
  } | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [isBoxSelecting, setIsBoxSelecting] = useState(false)
  const [selectionRect, setSelectionRect] = useState<BoxSelectionRect | null>(null)
  const [isMultiDragging, setIsMultiDragging] = useState(false)
  const [multiDragDeltaX, setMultiDragDeltaX] = useState(0)
  const [multiDragDeltaY, setMultiDragDeltaY] = useState(0)
  const selectionRectRef = useRef<BoxSelectionRect | null>(null)
  const isBoxSelectingRef = useRef(false)
  const multiDragDeltaRef = useRef({ x: 0, y: 0 })
  const suppressContainerClickRef = useRef(false)
  const visibleMembers = useVisibleMembers()

  const organizations = useOrganizationStore((s) => s.organizations)
  const teams = useTeamStore((s) => s.teams)
  const schedulerProjects = useSchedulerProjectsStore((s) => s.projects)

  // 조직·팀·프로젝트를 MM scope 라벨 소스로 통합한다.
  const projects = useMemo<ProjectMeta[]>(() => {
    const orgs: ProjectMeta[] = organizations.map((o) => ({
      id: o.organizationId,
      name: o.name,
      type: 'organization',
    }))
    const tms: ProjectMeta[] = teams.map((t) => ({
      id: t.teamId,
      name: t.name,
      type: 'team',
    }))
    const projs: ProjectMeta[] = schedulerProjects.map((p) => ({
      id: p.id,
      name: p.name,
      type: 'project',
    }))
    return [...orgs, ...tms, ...projs]
  }, [organizations, schedulerProjects, teams])

  const workspaceId = LC_SCHEDULER_WORKSPACE_ID

  // 공식 공휴일 + 사용자 등록 공휴일 합집합으로 holidayMap/holidayTimeSet 구성
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays)
  const { holidayMap, holidayTimeSet } = useMemo(() => {
    const map = new Map<number, string>()
    const timeSet = new Set<number>()
    // 표시 범위의 연도 경계를 커버한다.
    const years = new Set([currentYear - 1, currentYear, currentYear + 1])

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
  }, [currentYear, storeHolidays])

  const { slots, weekBlocks, mondays, slotCount } = useMemo(() => {
    if (mode === 'month') {
      const monthStart = startOfDay(new Date(currentYear, monthIndex, 1))
      const slots = buildMonthWorkdaySlots(currentYear, monthIndex)
      return {
        slots,
        weekBlocks: [],
        mondays: [monthStart, monthStart, monthStart] as const,
        slotCount: slots.length,
      }
    }

    const now = new Date()
    const thisWeekStart = addWeeks(startOfWeek(now), weekOffset)
    const lastWeekStart = subDays(thisWeekStart, 7)
    const nextWeekStart = addWeeks(thisWeekStart, 1)

    const mondays = [
      startOfDay(lastWeekStart),
      startOfDay(thisWeekStart),
      startOfDay(nextWeekStart),
    ] as const

    const slots = buildWeekDaySlots(mondays[0], mondays[1], mondays[2])

    const weekBlocks = mondays.map((mon, wi) => {
      const fri = addDays(mon, 4)
      const relativeOffset = weekOffset + wi - 1
      return {
        key: `${relativeOffset}:${mon.toISOString()}`,
        title: relativeWeekTitle(relativeOffset),
        subtitle: `${fmtMD(mon)} – ${fmtMD(fri)} (월–금)`,
        weekIndex: wi as 0 | 1 | 2,
      }
    })

    return { slots, weekBlocks, mondays, slotCount: WEEK_SLOT_COUNT }
  }, [currentYear, mode, monthIndex, weekOffset])

  const todaySlotIndex = useMemo(() => {
    const today = startOfDay(new Date())
    const idx = slots.findIndex((slot) => isSameDay(slot.date, today))
    if (idx >= 0) return idx

    if (mode === 'month') return null

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
  }, [mode, slots, mondays])

  const getSlotBackground = (slot: WeekDaySlot, _alphaHex: string): string => {
    const key = startOfDay(slot.date).getTime()
    if (holidayTimeSet.has(key)) {
      // 공휴일은 weekendColor 원색 사용
      return weekendColor
    }
    return 'transparent'
  }

  useEffect(() => {
    const next: Record<string, number> = {}
    allMembers.forEach((member) => {
      next[member.memberId] = Math.max(1, member.rowCount ?? 1)
    })
    setMemberRowCounts(next)
  }, [allMembers])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => setTimelineWidth(Math.max(900, container.clientWidth - MEMBER_COLUMN_WIDTH))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const effectiveSelectedProjectId =
    selectedProjectId?.startsWith('proj:') ? selectedProjectId.slice(5) : null
  const showGlobalRow = selectedProjectId !== null

  // 구성원 일정은 선택 scope와 무관하게 고유 구성원 행에 모두 표시한다.
  const { schedulesByMember: schedulesByMemberId, globalSchedules } = useMemo(
    () => groupSchedulesByMember(schedules, effectiveSelectedProjectId),
    [effectiveSelectedProjectId, schedules],
  )

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

  const cellWidth = timelineWidth / slotCount

  const openSchedulePage = useCallback((id: string) => {
    const parsed = parseScheduleInstanceId(id)
    if (!parsed) return
    openPeek(parsed.pageId)
  }, [openPeek])

  const memberRowItems = useMemo(() => (
    filteredMembers.reduce<{ items: MemberRowItem[]; top: number }>((acc, member) => {
      const allMember = schedulesByMemberId[member.memberId] || []
      const memberSchedules = [...allMember]
        .filter((s) => scheduleOverlapsAnyDaySlot(s, slots))
        .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0) || scheduleStartMs(a) - scheduleStartMs(b))
      const layouts = memberSchedules
        .map((schedule) => getScheduleSlotRange(schedule, slots))
        .filter((layout): layout is ScheduleWeekLayout => layout !== null)
      const cardRows = computeRowCount(memberSchedules)
      const userRows = memberRowCounts[member.memberId] ?? member.rowCount ?? 1
      const rowCount = Math.max(1, cardRows, userRows)
      const rowHeight = getRowHeight(rowCount, zoomLevel)
      const slotHeight = rowHeight / rowCount
      const item: MemberRowItem = {
        member,
        memberSchedules,
        layouts,
        rowCount,
        rowHeight,
        slotHeight,
        top: acc.top,
        cardRows,
        canRemove: userRows > Math.max(1, cardRows),
      }
      return {
        items: [...acc.items, item],
        top: acc.top + rowHeight,
      }
    }, { items: [], top: 0 }).items
  ), [filteredMembers, memberRowCounts, schedulesByMemberId, slots, zoomLevel])

  const visibleGlobalSchedules = useMemo(() => (
    [...globalSchedules]
      .filter((s) => scheduleOverlapsAnyDaySlot(s, slots))
      .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0) || scheduleStartMs(a) - scheduleStartMs(b))
  ), [globalSchedules, slots])

  const globalLayouts = useMemo(() => (
    visibleGlobalSchedules
      .map((schedule) => getScheduleSlotRange(schedule, slots))
      .filter((layout): layout is ScheduleWeekLayout => layout !== null)
  ), [slots, visibleGlobalSchedules])

  const globalCardRows = useMemo(
    () => computeRowCount(visibleGlobalSchedules),
    [visibleGlobalSchedules],
  )
  const effectiveGlobalRowCount = showGlobalRow
    ? Math.max(1, globalCardRows, globalRowCount)
    : 0
  const globalRowHeight = showGlobalRow
    ? getRowHeight(effectiveGlobalRowCount, zoomLevel)
    : 0
  const globalSlotHeight = effectiveGlobalRowCount > 0
    ? globalRowHeight / effectiveGlobalRowCount
    : 0
  const canRemoveGlobalRow = showGlobalRow && globalRowCount > Math.max(1, globalCardRows)

  const memberRowsHeight = useMemo(
    () => memberRowItems.reduce((sum, item) => sum + item.rowHeight, 0),
    [memberRowItems],
  )
  const bodyRowsHeight = globalRowHeight + memberRowsHeight
  const hasVisibleRows = showGlobalRow || filteredMembers.length > 0

  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set())
    setIsMultiDragging(false)
    setMultiDragDeltaX(0)
    setMultiDragDeltaY(0)
    multiDragDeltaRef.current = { x: 0, y: 0 }
  }, [])

  const isCardSelected = useCallback(
    (scheduleId: string) => selectedCardIds.has(scheduleId),
    [selectedCardIds],
  )

  const getCardsInRect = useCallback(
    (rect: BoxSelectionRect): Set<string> => {
      const result = new Set<string>()
      const selLeft = Math.min(rect.startX, rect.endX)
      const selRight = Math.max(rect.startX, rect.endX)
      const selTop = Math.min(rect.startY, rect.endY)
      const selBottom = Math.max(rect.startY, rect.endY)

      for (const item of memberRowItems) {
        for (const layout of item.layouts) {
          const rowIdx = Math.max(0, Math.min(item.rowCount - 1, layout.schedule.rowIndex ?? 0))
          const cardLeft = layout.startSlot * cellWidth
          const cardRight = (layout.endSlot + 1) * cellWidth
          const cardTop = WEEK_HEADER_HEIGHT + globalRowHeight + item.top + rowIdx * item.slotHeight
          const cardBottom = cardTop + item.slotHeight
          if (rectsIntersect(selLeft, selRight, selTop, selBottom, cardLeft, cardRight, cardTop, cardBottom)) {
            result.add(layout.schedule.id)
          }
        }
      }

      return result
    },
    [cellWidth, globalRowHeight, memberRowItems],
  )

  const getPointerInTimeline = useCallback((e: MousePointEvent, containerEl: HTMLElement) => {
    const rect = containerEl.getBoundingClientRect()
    return {
      x: e.clientX - rect.left + containerEl.scrollLeft - MEMBER_COLUMN_WIDTH,
      y: e.clientY - rect.top + containerEl.scrollTop,
    }
  }, [])

  const handleBoxSelectStart = useCallback((e: React.MouseEvent, containerEl: HTMLElement) => {
    const { x, y } = getPointerInTimeline(e, containerEl)
    const next: BoxSelectionRect = { startX: x, startY: y, endX: x, endY: y }
    selectionRectRef.current = next
    isBoxSelectingRef.current = true
    setSelectionRect(next)
    setSelectedCardIds(new Set())
    setIsBoxSelecting(true)
  }, [getPointerInTimeline])

  const handleBoxSelectMove = useCallback((e: MousePointEvent, containerEl: HTMLElement) => {
    if (!isBoxSelectingRef.current) return
    const { x, y } = getPointerInTimeline(e, containerEl)
    const next: BoxSelectionRect = {
      startX: selectionRectRef.current?.startX ?? x,
      startY: selectionRectRef.current?.startY ?? y,
      endX: x,
      endY: y,
    }
    selectionRectRef.current = next
    setSelectionRect(next)
    setSelectedCardIds(getCardsInRect(next))
  }, [getCardsInRect, getPointerInTimeline])

  const handleBoxSelectEnd = useCallback(() => {
    isBoxSelectingRef.current = false
    setIsBoxSelecting(false)
    setSelectionRect(null)
    selectionRectRef.current = null
  }, [])

  const finishBoxSelect = useCallback((e?: MousePointEvent) => {
    const container = containerRef.current
    if (!isBoxSelectingRef.current || !container) return
    if (e) {
      handleBoxSelectMove(e, container)
    }
    const finalRect = selectionRectRef.current
    const finalSelected = finalRect ? getCardsInRect(finalRect) : new Set<string>()
    setSelectedCardIds(finalSelected)
    const didDrag =
      finalRect != null &&
      (Math.abs(finalRect.endX - finalRect.startX) > 2 ||
        Math.abs(finalRect.endY - finalRect.startY) > 2 ||
        finalSelected.size > 0)
    handleBoxSelectEnd()
    if (didDrag) {
      suppressContainerClickRef.current = true
    }
  }, [getCardsInRect, handleBoxSelectEnd, handleBoxSelectMove])

  const handleMultiDragStart = useCallback((scheduleId: string) => {
    if (!selectedCardIds.has(scheduleId)) return
    multiDragDeltaRef.current = { x: 0, y: 0 }
    setIsMultiDragging(true)
    setMultiDragDeltaX(0)
    setMultiDragDeltaY(0)
  }, [selectedCardIds])

  const handleMultiDragMove = useCallback((deltaX: number, deltaY: number) => {
    multiDragDeltaRef.current = { x: deltaX, y: deltaY }
    setMultiDragDeltaX(deltaX)
    setMultiDragDeltaY(deltaY)
  }, [])

  const completeMultiDrag = useCallback((deltaX: number, deltaY: number): Schedule[] | null => {
    const finalDeltaX = multiDragDeltaRef.current.x || deltaX
    const finalDeltaY = multiDragDeltaRef.current.y || deltaY
    setIsMultiDragging(false)
    setMultiDragDeltaX(0)
    setMultiDragDeltaY(0)
    multiDragDeltaRef.current = { x: 0, y: 0 }

    const slotMove = Math.round(finalDeltaX / cellWidth)
    if (slotMove === 0 && finalDeltaY === 0) return null

    const selectedIds = selectedCardIds
    const updatedSchedules: Schedule[] = []
    const stationarySchedules = schedules.filter((schedule) => !selectedIds.has(schedule.id))

    for (const item of memberRowItems) {
      const rowDelta = item.slotHeight > 0 ? Math.round(finalDeltaY / item.slotHeight) : 0
      for (const layout of item.layouts) {
        if (!selectedIds.has(layout.schedule.id)) continue
        const span = Math.max(1, layout.endSlot - layout.startSlot + 1)
        const nextStartSlot = clampSlotStart(layout.startSlot + slotMove, span, slotCount)
        const nextEndSlot = nextStartSlot + span - 1
        const { startAt, endAt } = slotRangeToIso(slots, nextStartSlot, nextEndSlot)
        const rowIndex = Math.max(0, Math.min(item.rowCount - 1, (layout.schedule.rowIndex ?? 0) + rowDelta))
        updatedSchedules.push({
          ...layout.schedule,
          startAt,
          endAt,
          rowIndex,
        })
      }
    }

    for (const updated of updatedSchedules) {
      if (hasCollision(updated, stationarySchedules)) return null
    }

    return updatedSchedules
  }, [cellWidth, memberRowItems, schedules, selectedCardIds, slotCount, slots])

  const handleMultiDragComplete = useCallback((deltaX: number, deltaY: number) => {
    const updatedSchedules = completeMultiDrag(deltaX, deltaY)
    if (!updatedSchedules) return

    const previous = new Map(
      schedules
        .filter((schedule) => selectedCardIds.has(schedule.id))
        .map((schedule) => [schedule.id, schedule]),
    )

    useSchedulerStore.setState((state) => ({
      schedules: state.schedules.map((schedule) => (
        updatedSchedules.find((item) => item.id === schedule.id) ?? schedule
      )),
    }))

    updatedSchedules.forEach((updated) => {
      void updateSchedule({
        id: updated.id,
        workspaceId: updated.workspaceId,
        startAt: updated.startAt,
        endAt: updated.endAt,
        rowIndex: updated.rowIndex ?? 0,
      }).catch(() => {
        const prev = previous.get(updated.id)
        if (!prev) return
        useSchedulerStore.setState((state) => ({
          schedules: state.schedules.map((schedule) => (
            schedule.id === prev.id ? prev : schedule
          )),
        }))
      })
    })
  }, [completeMultiDrag, schedules, selectedCardIds, updateSchedule])

  const handleScheduleSelect = useCallback((id: string) => {
    selectSchedule(id)
    if (!isCardSelected(id)) clearSelection()
  }, [clearSelection, isCardSelected, selectSchedule])

  const handleAddRow = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules)
      const member = allMembers.find((item) => item.memberId === memberId)
      const previousRowCount = member?.rowCount ?? memberRowCounts[memberId] ?? 1
      const nextRowCount = Math.min(10, Math.max(previousRowCount, cardRows) + 1)

      setMemberRowCounts((prev) => ({ ...prev, [memberId]: nextRowCount }))
      useMemberStore.getState().upsertMember({
        ...(member ?? {
          memberId,
          email: '',
          name: '',
          jobRole: '',
          workspaceRole: 'member',
          status: 'active',
          personalWorkspaceId: '',
        }),
        rowCount: nextRowCount,
      })

      void updateMemberApi(memberId, { rowCount: nextRowCount }).catch(() => {
        setMemberRowCounts((prev) => ({ ...prev, [memberId]: previousRowCount }))
        if (member) {
          useMemberStore.getState().upsertMember({ ...member, rowCount: previousRowCount })
        }
      })
    },
    [allMembers, memberRowCounts],
  )

  const handleRemoveRow = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules)
      const member = allMembers.find((item) => item.memberId === memberId)
      const previousRowCount = member?.rowCount ?? memberRowCounts[memberId] ?? 1
      const nextRowCount = Math.max(1, cardRows, previousRowCount - 1)
      if (nextRowCount === previousRowCount) return

      setMemberRowCounts((prev) => ({ ...prev, [memberId]: nextRowCount }))
      if (member) {
        useMemberStore.getState().upsertMember({ ...member, rowCount: nextRowCount })
      }

      void updateMemberApi(memberId, { rowCount: nextRowCount }).catch(() => {
        setMemberRowCounts((prev) => ({ ...prev, [memberId]: previousRowCount }))
        if (member) {
          useMemberStore.getState().upsertMember({ ...member, rowCount: previousRowCount })
        }
      })
    },
    [allMembers, memberRowCounts],
  )

  const xToSlot = useCallback(
    (x: number) => Math.max(0, Math.min(slotCount - 1, Math.floor(x / cellWidth))),
    [cellWidth, slotCount],
  )

  const pointToScheduleRow = useCallback(
    (x: number, y: number): { top: number; height: number; rowIndex: number; assigneeId: string | null } | null => {
      if (x < 0 || x > timelineWidth || y < WEEK_HEADER_HEIGHT) return null
      const bodyY = y - WEEK_HEADER_HEIGHT
      if (showGlobalRow && bodyY >= 0 && bodyY < globalRowHeight) {
        const rowIndex = Math.max(0, Math.min(effectiveGlobalRowCount - 1, Math.floor(bodyY / globalSlotHeight)))
        return {
          top: WEEK_HEADER_HEIGHT + rowIndex * globalSlotHeight,
          height: globalSlotHeight,
          rowIndex,
          assigneeId: null,
        }
      }
      const memberBodyY = bodyY - globalRowHeight
      for (const item of memberRowItems) {
        if (memberBodyY < item.top || memberBodyY >= item.top + item.rowHeight) continue
        const rowIndex = Math.max(0, Math.min(item.rowCount - 1, Math.floor((memberBodyY - item.top) / item.slotHeight)))
        return {
          top: WEEK_HEADER_HEIGHT + globalRowHeight + item.top + rowIndex * item.slotHeight,
          height: item.slotHeight,
          rowIndex,
          assigneeId: item.member.memberId,
        }
      }
      return null
    },
    [effectiveGlobalRowCount, globalRowHeight, globalSlotHeight, memberRowItems, showGlobalRow, timelineWidth],
  )

  const handleContainerClick = useCallback(() => {
    if (suppressContainerClickRef.current) {
      suppressContainerClickRef.current = false
      return
    }
    selectSchedule(null)
    clearSelection()
  }, [clearSelection, selectSchedule])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('.schedule-card')) return
      if ((e.target as HTMLElement).closest('button, input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      const isCtrl = e.ctrlKey || e.metaKey
      const isAlt = e.altKey

      const container = containerRef.current
      if (!container) return

      if (isCtrl || isAlt) {
        const rect = container.getBoundingClientRect()
        const x = e.clientX - rect.left + container.scrollLeft
        const y = e.clientY - rect.top + container.scrollTop
        const row = pointToScheduleRow(x, y)
        if (!row) return
        if (isAlt && row.assigneeId == null) return

        e.preventDefault()
        const slot = xToSlot(Math.max(0, Math.min(timelineWidth - 1, x)))
        const next = {
          kind: isAlt ? 'leave' as const : 'schedule' as const,
          startSlot: slot,
          currentSlot: slot,
          rowTop: row.top,
          rowHeight: row.height,
          rowIndex: row.rowIndex,
          assigneeId: row.assigneeId,
          active: false,
        }
        dragRef.current = next
        setDragState(next)
        selectSchedule(null)
        clearSelection()
        return
      }

      e.preventDefault()
      handleBoxSelectStart(e, container)
    },
    [clearSelection, handleBoxSelectStart, pointToScheduleRow, selectSchedule, timelineWidth, xToSlot],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBoxSelectingRef.current) return
      const container = containerRef.current
      if (container) handleBoxSelectMove(e, container)
    },
    [handleBoxSelectMove],
  )

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    finishBoxSelect(e)
  }, [finishBoxSelect])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || dragRef.current) {
      e.preventDefault()
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isBoxSelectingRef.current) return
      const container = containerRef.current
      if (container) handleBoxSelectMove(e, container)
    }

    const onMouseUp = (e: MouseEvent) => {
      finishBoxSelect(e)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [finishBoxSelect, handleBoxSelectMove])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const rawX = e.clientX - rect.left + container.scrollLeft - MEMBER_COLUMN_WIDTH
      const slot = xToSlot(Math.max(0, Math.min(timelineWidth - 1, rawX)))
      const dx = Math.abs(slot - dragRef.current.startSlot) * cellWidth
      const next = {
        ...dragRef.current,
        currentSlot: slot,
        active: dragRef.current.active || dx > MARQUEE_ACTIVATE_PX,
      }
      dragRef.current = next
      setDragState(next)
    }

    const onMouseUp = () => {
      const cur = dragRef.current
      if (!cur) return
      if (cur.active) {
        const startSlot = Math.min(cur.startSlot, cur.currentSlot)
        const endSlot = Math.max(cur.startSlot, cur.currentSlot)
        const { startAt, endAt } = slotRangeToIso(slots, startSlot, endSlot)
        setPendingCreateMarquee({
          kind: cur.kind,
          rowTop: cur.rowTop,
          rowHeight: cur.rowHeight,
          startSlot,
          endSlot,
        })

        if (cur.kind === 'leave') {
          void createSchedule({
            workspaceId,
            title: LC_SCHEDULER_ATTENDANCE_TITLE,
            projectId: effectiveSelectedProjectId ?? null,
            assigneeId: cur.assigneeId,
            selectedScopeKey: selectedProjectId,
            color: ANNUAL_LEAVE_COLOR,
            textColor: pickTextColor(ANNUAL_LEAVE_COLOR),
            startAt,
            endAt,
            rowIndex: cur.rowIndex,
          }).catch((error) => {
            console.error(error)
            window.alert('근태 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
          })
          queueMicrotask(() => setPendingCreateMarquee(null))
        } else {
          const pendingPeekPageId = `${PENDING_SCHEDULE_PAGE_ID_PREFIX}${Date.now()}`
          openPeek(pendingPeekPageId)
          void createSchedule({
            workspaceId,
            title: '새 일정',
            projectId: effectiveSelectedProjectId ?? null,
            assigneeId: cur.assigneeId,
            selectedScopeKey: selectedProjectId,
            color: DEFAULT_SCHEDULE_COLOR,
            textColor: pickTextColor(DEFAULT_SCHEDULE_COLOR),
            startAt,
            endAt,
            rowIndex: cur.rowIndex,
          }).then((schedule) => {
            selectSchedule(schedule.id)
            const currentPeekPageId = useUiStore.getState().peekPageId
            if (!currentPeekPageId || currentPeekPageId === pendingPeekPageId) {
              openSchedulePage(schedule.id)
            }
          }).catch((error) => {
            console.error(error)
            if (useUiStore.getState().peekPageId === pendingPeekPageId) {
              useUiStore.getState().closePeek()
            }
            window.alert('일정 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
          })
          queueMicrotask(() => setPendingCreateMarquee(null))
        }
      }
      dragRef.current = null
      setDragState(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [
    cellWidth,
    createSchedule,
    effectiveSelectedProjectId,
    openPeek,
    openSchedulePage,
    selectSchedule,
    selectedProjectId,
    slots,
    timelineWidth,
    workspaceId,
    xToSlot,
  ])

  const createMarqueeStyle = useMemo(() => {
    if (!dragState && !pendingCreateMarquee) return null
    const source = dragState
      ? {
          kind: dragState.kind,
          rowTop: dragState.rowTop,
          rowHeight: dragState.rowHeight,
          startSlot: Math.min(dragState.startSlot, dragState.currentSlot),
          endSlot: Math.max(dragState.startSlot, dragState.currentSlot),
        }
      : pendingCreateMarquee
    if (!source) return null
    return {
      kind: source.kind,
      left: source.startSlot * cellWidth,
      top: source.rowTop,
      width: Math.max(cellWidth, (source.endSlot - source.startSlot + 1) * cellWidth),
      height: source.rowHeight,
    }
  }, [cellWidth, dragState, pendingCreateMarquee])

  const boxMarqueeStyle = useMemo(() => {
    if (!isBoxSelecting || !selectionRect) return null
    return {
      left: Math.min(selectionRect.startX, selectionRect.endX),
      top: Math.min(selectionRect.startY, selectionRect.endY),
      width: Math.abs(selectionRect.endX - selectionRect.startX),
      height: Math.abs(selectionRect.endY - selectionRect.startY),
    }
  }, [isBoxSelecting, selectionRect])

  const mmWeekIndicatorStyle = useMemo(() => {
    if (!mmWeekStart) return null
    const start = startOfDay(parseDateKey(mmWeekStart))
    const end = addDays(start, 4)
    let startSlot = -1
    let endSlot = -1

    slots.forEach((slot, index) => {
      const time = startOfDay(slot.date).getTime()
      if (time < start.getTime() || time > end.getTime()) return
      if (startSlot < 0) startSlot = index
      endSlot = index
    })

    if (startSlot < 0 || endSlot < startSlot) return null
    return {
      left: startSlot * cellWidth + WEEK_CARD_MARGIN,
      width: Math.max(2, (endSlot - startSlot + 1) * cellWidth - WEEK_CARD_MARGIN * 2),
    }
  }, [cellWidth, mmWeekStart, slots])

  useEffect(() => {
    if (mode !== 'week' || !mmWeekStart) return
    const selectedWeek = startOfDay(parseDateKey(mmWeekStart))
    const currentWeek = startOfWeek(new Date())
    const relativeWeekOffset = Math.round(differenceInCalendarDays(selectedWeek, currentWeek) / 7)
    setWeekOffset((value) => {
      if (relativeWeekOffset >= value - 1 && relativeWeekOffset <= value + 1) return value
      return relativeWeekOffset
    })
  }, [mmWeekStart, mode])

  const shiftWeekRange = useCallback((delta: number) => {
    setWeekOffset((value) => value + delta)
  }, [])

  const shiftMonthRange = useCallback((delta: number) => {
    setMonthIndex((value) => {
      const next = value + delta
      if (next < 0) {
        setCurrentYear(currentYear - 1)
        return 11
      }
      if (next > 11) {
        setCurrentYear(currentYear + 1)
        return 0
      }
      return next
    })
  }, [currentYear, setCurrentYear])

  useEffect(() => {
    const handleScrollToday = () => {
      const today = new Date()
      if (mode === 'month') {
        setCurrentYear(today.getFullYear())
        setMonthIndex(today.getMonth())
        return
      }
      setWeekOffset(0)
    }

    window.addEventListener('lc-scheduler:scroll-today', handleScrollToday)
    return () => window.removeEventListener('lc-scheduler:scroll-today', handleScrollToday)
  }, [mode, setCurrentYear])

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      <div
        ref={containerRef}
        className="flex-1 overflow-auto overscroll-y-none relative"
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        style={{
          userSelect: (dragState || isBoxSelecting) ? 'none' : undefined,
          overscrollBehaviorY: 'none',
        }}
      >
        <div
          style={{
            width: timelineWidth + MEMBER_COLUMN_WIDTH,
            minWidth: timelineWidth + MEMBER_COLUMN_WIDTH,
            minHeight: WEEK_HEADER_HEIGHT + bodyRowsHeight + (hasVisibleRows ? TIMELINE_BOTTOM_SPACER_HEIGHT : 0),
            position: 'relative',
          }}
        >
          <div className="sticky left-0 z-30 w-[120px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div
              className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              style={{ height: WEEK_HEADER_HEIGHT }}
            />
            <div
              style={{
                height: bodyRowsHeight + (hasVisibleRows ? TIMELINE_BOTTOM_SPACER_HEIGHT : 0),
                position: 'relative',
              }}
            >
              {showGlobalRow && (
                <div
                  className="group absolute left-0 right-0 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center px-2 bg-amber-50/40 dark:bg-amber-950/20"
                  style={{ top: 0, height: globalRowHeight }}
                >
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400 truncate max-w-full text-center">
                    특이사항
                  </span>
                  <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setGlobalRowCount((n) => Math.min(10, Math.max(n, globalCardRows) + 1))}
                      title="행 추가"
                      disabled={globalRowCount >= 10}
                      className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                    >
                      <Plus size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setGlobalRowCount((n) => Math.max(1, globalCardRows, n - 1))}
                      title="행 제거"
                      disabled={!canRemoveGlobalRow}
                      className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                    >
                      <Minus size={10} />
                    </button>
                  </div>
                </div>
              )}
              {memberRowItems.map((item) => (
                <div
                  key={item.member.memberId}
                  className="group absolute left-0 right-0 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center px-2"
                  style={{ top: globalRowHeight + item.top, height: item.rowHeight }}
                >
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-full text-center" title={item.member.name}>
                    {item.member.name}
                  </span>
                  <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleAddRow(item.member.memberId, item.memberSchedules)}
                      title="행 추가"
                      disabled={(memberRowCounts[item.member.memberId] ?? 1) >= 10}
                      className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                    >
                      <Plus size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(item.member.memberId, item.memberSchedules)}
                      title="행 제거"
                      disabled={!item.canRemove}
                      className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                    >
                      <Minus size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              width: timelineWidth,
              minWidth: timelineWidth,
              position: 'absolute',
              top: 0,
              left: MEMBER_COLUMN_WIDTH,
            }}
          >
          <div
            className="sticky top-0 z-30 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800"
            style={{ height: WEEK_HEADER_HEIGHT, width: timelineWidth }}
          >
            {mode === 'month' ? (
              <div className="h-10 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => shiftMonthRange(-1)}
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="이전 월"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-[96px] text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {monthIndex + 1}월
                </div>
                <button
                  type="button"
                  onClick={() => shiftMonthRange(1)}
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="다음 월"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            ) : (
              <div
                className="grid border-b border-zinc-200 dark:border-zinc-800"
                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', height: 40 }}
              >
                {weekBlocks.map((block) => (
                  <div
                    key={block.key}
                    className="text-center border-r border-zinc-200 dark:border-zinc-800 last:border-r-0 flex items-center justify-center gap-1.5 px-1"
                  >
                    {block.weekIndex === 0 && (
                      <button
                        type="button"
                        onClick={() => shiftWeekRange(-1)}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        aria-label="이전 주"
                      >
                        <ChevronLeft size={16} />
                      </button>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{block.title}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight px-1 truncate">{block.subtitle}</div>
                    </div>
                    {block.weekIndex === 2 && (
                      <button
                        type="button"
                        onClick={() => shiftWeekRange(1)}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        aria-label="다음 주"
                      >
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="grid" style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))`, height: 36 }}>
              {slots.map((slot, i) => {
                const holidayText = holidayMap.get(startOfDay(slot.date).getTime())
                return (
                  <div
                    key={`${slot.date.getTime()}-${i}`}
                    className="text-[10px] text-center border-r border-zinc-200/60 dark:border-zinc-800/60 last:border-r-0 text-zinc-500 dark:text-zinc-400 leading-tight flex flex-col items-center justify-center"
                    style={{
                      backgroundColor: getSlotBackground(slot, '0f'),
                      ...(mode === 'month' && slot.weekBoundaryBefore
                        ? { borderLeft: '2px dotted rgba(113, 113, 122, 0.75)' }
                        : {}),
                    }}
                    title={holidayText || undefined}
                  >
                    <div className="font-medium text-zinc-900/80 dark:text-zinc-100/80">{fmtDow(slot.date)}</div>
                    <div className="tabular-nums">{fmtMD(slot.date)}</div>
                    {holidayText ? (
                      <div className="text-[9px] leading-tight text-zinc-900/85 dark:text-zinc-100/85 truncate px-0.5 max-w-full">
                        {holidayText}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {todaySlotIndex !== null && (
            <div
              className="absolute bg-blue-500 z-10 pointer-events-none"
              style={{
                top: WEEK_HEADER_HEIGHT,
                height: bodyRowsHeight,
                left: todaySlotIndex * cellWidth + cellWidth / 2 - 2,
                width: 4,
                boxShadow: '0 0 8px rgba(59,130,246,0.6)',
              }}
            />
          )}

          <div className="relative" style={{ height: bodyRowsHeight, width: timelineWidth }}>
            {showGlobalRow && (
              <div
                className="absolute left-0 border-b border-zinc-200 dark:border-zinc-800 bg-amber-50/40 dark:bg-amber-950/20"
                style={{ top: 0, height: globalRowHeight, width: timelineWidth }}
              >
                <div
                  className="absolute inset-0 grid pointer-events-none"
                  style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
                >
                  {slots.map((slot, i) => (
                    <div
                      key={`global-bg-${i}`}
                      className="border-r border-zinc-200/40 dark:border-zinc-800/40 last:border-r-0"
                      style={{
                        backgroundColor: getSlotBackground(slot, '14'),
                        ...(mode === 'month' && slot.weekBoundaryBefore
                          ? { borderLeft: '2px dotted rgba(113, 113, 122, 0.75)' }
                          : {}),
                      }}
                    />
                  ))}
                </div>
                {globalLayouts.map((layout) => (
                  <ScheduleWeekCard
                    key={layout.schedule.id}
                    schedule={layout.schedule}
                    projects={projects}
                    members={allMembers}
                    slots={slots}
                    startSlot={layout.startSlot}
                    endSlot={layout.endSlot}
                    slotCount={slotCount}
                    cellWidth={cellWidth}
                    slotHeight={globalSlotHeight}
                    rowCount={effectiveGlobalRowCount}
                    allSchedules={schedules}
                    isSelected={selectedScheduleId === layout.schedule.id}
                    onSelect={handleScheduleSelect}
                    onOpenPage={openSchedulePage}
                    onUpdate={updateSchedule}
                    onCreate={createSchedule}
                  />
                ))}
              </div>
            )}
            {memberRowItems.map((item) => (
              <div
                key={item.member.memberId}
                className="absolute left-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                style={{ top: globalRowHeight + item.top, height: item.rowHeight, width: timelineWidth }}
              >
                <div
                  className="absolute inset-0 grid pointer-events-none"
                  style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
                >
                  {slots.map((slot, i) => (
                    <div
                      key={`bg-${item.member.memberId}-${i}`}
                      className="border-r border-zinc-200/40 dark:border-zinc-800/40 last:border-r-0"
                      style={{
                        backgroundColor: getSlotBackground(slot, '14'),
                        ...(mode === 'month' && slot.weekBoundaryBefore
                          ? { borderLeft: '2px dotted rgba(113, 113, 122, 0.75)' }
                          : {}),
                      }}
                    />
                  ))}
                </div>
                {item.layouts.map((layout) => (
                  <ScheduleWeekCard
                    key={layout.schedule.id}
                    schedule={layout.schedule}
                    projects={projects}
                    members={allMembers}
                    slots={slots}
                    startSlot={layout.startSlot}
                    endSlot={layout.endSlot}
                    slotCount={slotCount}
                    cellWidth={cellWidth}
                    slotHeight={item.slotHeight}
                    rowCount={item.rowCount}
                    allSchedules={schedules}
                    isSelected={selectedScheduleId === layout.schedule.id || isCardSelected(layout.schedule.id)}
                    isMultiSelected={isCardSelected(layout.schedule.id)}
                    multiDragDeltaX={isMultiDragging && isCardSelected(layout.schedule.id) ? multiDragDeltaX : null}
                    multiDragDeltaY={isMultiDragging && isCardSelected(layout.schedule.id) ? multiDragDeltaY : null}
                    onMultiDragStart={() => handleMultiDragStart(layout.schedule.id)}
                    onMultiDragMove={handleMultiDragMove}
                    onMultiDragEnd={handleMultiDragComplete}
                    onSelect={handleScheduleSelect}
                    onOpenPage={openSchedulePage}
                    onUpdate={updateSchedule}
                    onCreate={createSchedule}
                  />
                ))}
              </div>
            ))}
          </div>

          {hasVisibleRows && (
            <div
              aria-hidden="true"
              style={{
                height: TIMELINE_BOTTOM_SPACER_HEIGHT,
                width: timelineWidth,
                position: 'relative',
              }}
            >
              {mmWeekIndicatorStyle && (
                <div
                  className="absolute rounded-full bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
                  style={{
                    left: mmWeekIndicatorStyle.left,
                    top: 28,
                    width: mmWeekIndicatorStyle.width,
                    height: 4,
                  }}
                />
              )}
            </div>
          )}

          {createMarqueeStyle && (
            <div
              className={`absolute z-50 pointer-events-none rounded-md border-2 ${
                createMarqueeStyle.kind === 'leave'
                  ? 'border-red-500 bg-red-500/20'
                  : 'border-emerald-500 bg-emerald-500/20'
              }`}
              style={{
                left: createMarqueeStyle.left + WEEK_CARD_MARGIN,
                top: createMarqueeStyle.top + WEEK_CARD_MARGIN,
                width: Math.max(0, createMarqueeStyle.width - WEEK_CARD_MARGIN * 2),
                height: Math.max(0, createMarqueeStyle.height - WEEK_CARD_MARGIN * 2),
              }}
            />
          )}

          {boxMarqueeStyle && (
            <div
              className="absolute border-2 border-blue-400 bg-blue-400/15 rounded-sm pointer-events-none"
              style={{
                left: boxMarqueeStyle.left,
                top: boxMarqueeStyle.top,
                width: boxMarqueeStyle.width,
                height: boxMarqueeStyle.height,
                zIndex: 90,
              }}
            />
          )}
        </div>

        {filteredMembers.length === 0 && !showGlobalRow && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500 dark:text-zinc-400 text-sm p-8 min-h-[120px]">
            표시할 구성원이 없습니다. 필터를 조정해 보세요.
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

export function WeekScheduleView() {
  return <ScheduleRangeView mode="week" />
}

export function MonthScheduleView() {
  return <ScheduleRangeView mode="month" />
}
