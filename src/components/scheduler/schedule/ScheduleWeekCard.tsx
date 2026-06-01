// 주간/월간 뷰에서 개별 일정을 드래그·리사이즈 가능한 카드로 렌더링하는 컴포넌트

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Rnd } from 'react-rnd'
import { ExternalLink } from 'lucide-react'
import { useSchedulerStore, type Schedule } from '../../../store/schedulerStore'
import { useSchedulerViewStore } from '../../../store/schedulerViewStore'
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR, pickTextColor } from '../../../lib/scheduler/colors'
import type { Member } from '../../../store/memberStore'
import { hasCollision } from '../../../lib/scheduler/collisionDetection'
import { ContextMenu } from '../ContextMenu'
import { getScheduleCardContentOffset, shouldUseCompactScheduleCard } from '../scheduleCardDisplay'
import { ScheduleCardPropertyLabels } from '../ScheduleCardPropertyLabels'
import { ScheduleCardDetailRows } from '../../database/ScheduleCardDetailRows'
import { usePageStore } from '../../../store/pageStore'
import { parseScheduleInstanceId } from '../../../lib/scheduler/taskAdapter'
import {
  type ProjectMeta,
  type WeekDaySlot,
  type TooltipPos,
  PAST_WEEK_GRAY,
  WEEK_CARD_MARGIN,
  isAnnualLeaveSchedule,
  getScheduleScopeMeta,
  slotRangeToIso,
  clampSlotStart,
} from './weekScheduleUtils'

export function ScheduleWeekCard({
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
  scrollLeft,
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
  scrollLeft: number
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
  const zoomLevel = useSchedulerViewStore((state) => state.zoomLevel)
  const compactLayout = shouldUseCompactScheduleCard(zoomLevel)
  // 호버 툴팁에 표시 설정 속성을 함께 보여주기 위한 원본 작업 DB 행 참조.
  const taskPageId = parseScheduleInstanceId(s.id)?.pageId
  const taskDatabaseId = usePageStore((state) => (taskPageId ? state.pages[taskPageId]?.databaseId : undefined))
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
  const effectiveX = isMultiSelected && multiDragDeltaX != null ? x + multiDragDeltaX : localX
  const effectiveY = isMultiSelected && multiDragDeltaY != null ? y + multiDragDeltaY : localY
  const visualWidth = Math.max(0, localW - WEEK_CARD_MARGIN * 2)
  const contentOffset = getScheduleCardContentOffset({
    scrollLeft,
    cardLeft: effectiveX + WEEK_CARD_MARGIN,
    cardWidth: visualWidth,
  })

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
        data-schedule-card-interactive="true"
        bounds="parent"
        dragAxis={rowCount > 1 ? 'both' : 'x'}
        dragGrid={[1, 1]}
        resizeGrid={[cellWidth, 1]}
        minWidth={Math.max(1, cellWidth - WEEK_CARD_MARGIN * 2)}
        position={{
          x: effectiveX + WEEK_CARD_MARGIN,
          y: effectiveY + WEEK_CARD_MARGIN,
        }}
        size={{
          width: visualWidth,
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
          className="relative w-full h-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500/60"
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
          <div
            className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
            style={{ left: contentOffset + 6, right: 6 }}
          >
            <span className="shrink-0 text-[11px] font-semibold leading-tight">
              {annual ? s.title || '연차' : s.title || '제목 없음'}
            </span>
            {!compactLayout && (
              <ScheduleCardPropertyLabels
                scheduleId={s.id}
                className="text-[10px] leading-tight opacity-80"
              />
            )}
            {s.link && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(s.link ?? '', '_blank', 'noopener,noreferrer')
                }}
                className="shrink-0 p-0.5 rounded bg-black/25 hover:bg-black/35 transition-colors"
                title="링크 열기"
              >
                <ExternalLink size={10} />
              </button>
            )}
          </div>
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
            <ScheduleCardDetailRows
              databaseId={taskDatabaseId}
              pageId={taskPageId}
              excludeDateColumns
            />
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
