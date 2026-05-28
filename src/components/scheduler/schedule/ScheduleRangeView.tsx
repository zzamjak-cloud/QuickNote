// 주간/월간 범위 뷰 — 멤버별 행 레이아웃과 일정 카드 렌더링을 담당하는 메인 컴포넌트

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import {
  addDays,
  startOfDay,
  isSameDay,
  startOfWeek,
} from '../../../lib/scheduler/dateUtils'
import { useSchedulerStore } from '../../../store/schedulerStore'
import { useSchedulerViewStore } from '../../../store/schedulerViewStore'
import { useOrganizationStore } from '../../../store/organizationStore'
import { useTeamStore } from '../../../store/teamStore'
import { useSchedulerHolidaysStore } from '../../../store/schedulerHolidaysStore'
import { useSchedulerProjectsStore } from '../../../store/schedulerProjectsStore'
import { useVisibleMembers } from '../hooks/useVisibleMembers'
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR, pickTextColor } from '../../../lib/scheduler/colors'
import { useMemberStore } from '../../../store/memberStore'
import { getHolidaysForYear } from '../../../lib/scheduler/koreanHolidays'
import { LC_SCHEDULER_WORKSPACE_ID } from '../../../lib/scheduler/scope'
import { parseScheduleInstanceId } from '../../../lib/scheduler/taskAdapter'
import { LC_SCHEDULER_ATTENDANCE_TITLE } from '../../../lib/scheduler/database'
import { useUiStore } from '../../../store/uiStore'
import { computeRowCount, hasCollision } from '../../../lib/scheduler/collisionDetection'
import { updateMemberApi } from '../../../lib/sync/memberApi'
import { getRowHeight } from '../../../lib/scheduler/grid'
import { groupSchedulesByMember } from '../../../lib/scheduler/selectors/scheduleSelectors'
import { parseDateKey } from '../../../lib/scheduler/mm/weekUtils'
import {
  PENDING_SCHEDULE_PAGE_ID_PREFIX,
  ScheduleDeleteConfirmDialog,
  SchedulerBoxMarquee,
  SchedulerCreateMarquee,
  getSchedulerBoxMarqueeStyle,
  isSchedulerInteractionTarget,
  rectsIntersect,
  useScheduleCreateDrag,
  useScheduleDeleteFlow,
  useSchedulerBoxSelection,
  type SchedulerBoxRect,
  type SchedulerCreateRange,
} from '../hooks/scheduleInteractions'
import { ScheduleWeekCard } from './ScheduleWeekCard'
import {
  type ProjectMeta,
  type WeekDaySlot,
  type ScheduleWeekLayout,
  type MemberRowItem,
  WEEK_SLOT_COUNT,
  WEEK_HEADER_HEIGHT,
  WEEK_CARD_MARGIN,
  TIMELINE_BOTTOM_SPACER_HEIGHT,
  MEMBER_COLUMN_WIDTH,
  addWeeks,
  subDays,
  differenceInCalendarDays,
  fmtMD,
  fmtDow,
  scheduleStartMs,
  buildWeekDaySlots,
  buildMonthDaySlots,
  relativeWeekTitle,
  scheduleOverlapsAnyDaySlot,
  getScheduleSlotRange,
  slotRangeToIso,
  clampSlotStart,
} from './weekScheduleUtils'

export function ScheduleRangeView({ mode }: { mode: 'week' | 'month' }) {
  const schedules = useSchedulerStore((s) => s.schedules)
  const createSchedule = useSchedulerStore((s) => s.createSchedule)
  const updateSchedule = useSchedulerStore((s) => s.updateSchedule)
  const deleteSchedule = useSchedulerStore((s) => s.deleteSchedule)
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
  const peekPageId = useUiStore((s) => s.peekPageId)
  const allMembers = useMemberStore((s) => s.members)

  const containerRef = useRef<HTMLDivElement>(null)
  const [timelineWidth, setTimelineWidth] = useState(900)
  const [memberRowCounts, setMemberRowCounts] = useState<Record<string, number>>({})
  const [globalRowCount, setGlobalRowCount] = useState(1)
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth())
  const [scrollLeft, setScrollLeft] = useState(0)
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
      const slots = buildMonthDaySlots(currentYear, monthIndex)
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
    if (holidayTimeSet.has(key) || (mode === 'month' && (slot.date.getDay() === 0 || slot.date.getDay() === 6))) {
      // 월간 주말과 공휴일은 연간 보기와 동일한 배경색 사용
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

  // 구성원 일정은 선택 scope와 무관하게 고유 구성원 행에 모두 표시하고, 특이사항은 현재 스코프에 귀속된 것만 표시한다.
  const { schedulesByMember: schedulesByMemberId, globalSchedules } = useMemo(
    () => groupSchedulesByMember(schedules, selectedProjectId),
    [selectedProjectId, schedules],
  )

  // selectedMemberId · multiSelectedIds 필터 적용
  const filteredMembers = useMemo(() => {
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

  const getCardsInRect = useCallback(
    (rect: SchedulerBoxRect): Set<string> => {
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

  const getMultiDragUpdates = useCallback((deltaX: number, deltaY: number, selectedIds: Set<string>) => {
    const slotMove = Math.round(deltaX / cellWidth)
    if (slotMove === 0 && deltaY === 0) return null

    const updatedSchedules = []
    const stationarySchedules = schedules.filter((schedule) => !selectedIds.has(schedule.id))

    for (const item of memberRowItems) {
      const rowDelta = item.slotHeight > 0 ? Math.round(deltaY / item.slotHeight) : 0
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
  }, [cellWidth, memberRowItems, schedules, slotCount, slots])

  const {
    selectedCardIds,
    isBoxSelecting,
    selectionRect,
    isMultiDragging,
    multiDragDeltaX,
    multiDragDeltaY,
    handleBoxSelectStart,
    handleBoxSelectMove,
    finishBoxSelect,
    handleMultiDragStart,
    handleMultiDragMove,
    handleMultiDragEnd,
    clearSelection,
    isCardSelected,
  } = useSchedulerBoxSelection({
    contentXOffset: MEMBER_COLUMN_WIDTH,
    getCardsInRect,
    getMultiDragUpdates,
  })

  const handleMultiDragComplete = useCallback((deltaX: number, deltaY: number) => {
    const updatedSchedules = handleMultiDragEnd(deltaX, deltaY)
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
  }, [handleMultiDragEnd, schedules, selectedCardIds, updateSchedule])

  const handleScheduleSelect = useCallback((id: string) => {
    selectSchedule(id)
    if (!isCardSelected(id)) clearSelection()
  }, [clearSelection, isCardSelected, selectSchedule])

  const handleAddRow = useCallback(
    (memberId: string, memberSchedules: ReturnType<typeof useSchedulerStore.getState>['schedules']) => {
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
    (memberId: string, memberSchedules: ReturnType<typeof useSchedulerStore.getState>['schedules']) => {
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

  const handleCreateRange = useCallback(
    (range: SchedulerCreateRange) => {
      const { startAt, endAt } = slotRangeToIso(slots, range.startIndex, range.endIndex)

      if (range.kind === 'leave') {
        void createSchedule({
          workspaceId,
          title: LC_SCHEDULER_ATTENDANCE_TITLE,
          projectId: effectiveSelectedProjectId ?? null,
          assigneeId: range.assigneeId,
          selectedScopeKey: selectedProjectId,
          color: ANNUAL_LEAVE_COLOR,
          textColor: pickTextColor(ANNUAL_LEAVE_COLOR),
          startAt,
          endAt,
          rowIndex: range.rowIndex,
        }).catch((error) => {
          console.error(error)
          window.alert('근태 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        })
        return
      }

      const pendingPeekPageId = `${PENDING_SCHEDULE_PAGE_ID_PREFIX}${Date.now()}`
      openPeek(pendingPeekPageId)
      void createSchedule({
        workspaceId,
        title: '새 일정',
        projectId: effectiveSelectedProjectId ?? null,
        assigneeId: range.assigneeId,
        selectedScopeKey: selectedProjectId,
        color: DEFAULT_SCHEDULE_COLOR,
        textColor: pickTextColor(DEFAULT_SCHEDULE_COLOR),
        startAt,
        endAt,
        rowIndex: range.rowIndex,
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
    },
    [
      createSchedule,
      effectiveSelectedProjectId,
      openPeek,
      openSchedulePage,
      selectSchedule,
      selectedProjectId,
      slots,
      workspaceId,
    ],
  )

  const {
    dragState,
    beginCreateDrag,
    handleCreateContextMenu,
    createMarqueeStyle,
  } = useScheduleCreateDrag({
    containerRef,
    contentXOffset: MEMBER_COLUMN_WIDTH,
    timelineWidth,
    cellWidth,
    pointToRow: pointToScheduleRow,
    xToIndex: xToSlot,
    clearSelection,
    onCreateRange: handleCreateRange,
  })

  const {
    deleteConfirmTarget,
    cancelDelete,
    confirmDelete,
  } = useScheduleDeleteFlow({
    schedules,
    selectedScheduleId,
    selectedCardCount: selectedCardIds.size,
    peekPageId,
    workspaceId,
    clearSelection,
    selectSchedule,
    openSchedulePage,
    deleteSchedule,
  })

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
      if (isSchedulerInteractionTarget(e.target)) return

      const container = containerRef.current
      if (!container) return

      if (beginCreateDrag(e)) return

      e.preventDefault()
      handleBoxSelectStart(e, container)
    },
    [beginCreateDrag, handleBoxSelectStart],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (container) handleBoxSelectMove(e, container)
    },
    [handleBoxSelectMove],
  )

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (finishBoxSelect(e, containerRef.current)) {
      suppressContainerClickRef.current = true
    }
  }, [finishBoxSelect])

  const handleContainerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const nextScrollLeft = e.currentTarget.scrollLeft
    setScrollLeft((value) => (value === nextScrollLeft ? value : nextScrollLeft))
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (container) handleBoxSelectMove(e, container)
    }

    const onMouseUp = (e: MouseEvent) => {
      if (finishBoxSelect(e, containerRef.current)) {
        suppressContainerClickRef.current = true
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [finishBoxSelect, handleBoxSelectMove])

  const boxMarqueeStyle = useMemo(() => {
    return getSchedulerBoxMarqueeStyle(isBoxSelecting, selectionRect)
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
    <>
      <div className="flex flex-1 min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      <div
        ref={containerRef}
        className="flex-1 overflow-auto overscroll-y-none relative"
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onScroll={handleContainerScroll}
        onContextMenu={handleCreateContextMenu}
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
                    scrollLeft={scrollLeft}
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
                    scrollLeft={scrollLeft}
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

          <SchedulerCreateMarquee style={createMarqueeStyle} />
          <SchedulerBoxMarquee style={boxMarqueeStyle} />
        </div>

        {filteredMembers.length === 0 && !showGlobalRow && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500 dark:text-zinc-400 text-sm p-8 min-h-[120px]">
            표시할 구성원이 없습니다. 필터를 조정해 보세요.
          </div>
        )}
      </div>
      </div>
      </div>
      <ScheduleDeleteConfirmDialog
        target={deleteConfirmTarget}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </>
  )
}
