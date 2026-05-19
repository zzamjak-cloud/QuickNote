/* eslint-disable react-refresh/only-export-components -- 스케줄러 인터랙션 훅과 오버레이를 한 모듈에서 공유한다. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import type { Schedule } from '../../../store/schedulerStore'
import { SimpleConfirmDialog } from '../../ui/SimpleConfirmDialog'

export const PENDING_SCHEDULE_PAGE_ID_PREFIX = 'lc-scheduler:creating:'

const MARQUEE_ACTIVATE_PX = 4
const SCHEDULE_INTERACTION_SELECTOR =
  ".schedule-card, .react-draggable, .react-resizable-handle, [data-schedule-card-interactive='true']"
const EDITABLE_TARGET_SELECTOR = "input, textarea, select, [contenteditable='true'], [role='textbox']"

type MousePointEvent = {
  clientX: number
  clientY: number
}

export type SchedulerCreateKind = 'schedule' | 'leave'

export type SchedulerTimelineRow = {
  top: number
  height: number
  rowIndex: number
  assigneeId: string | null
}

export type SchedulerCreateDragState = {
  kind: SchedulerCreateKind
  startIndex: number
  currentIndex: number
  rowTop: number
  rowHeight: number
  rowIndex: number
  assigneeId: string | null
  active: boolean
}

export type SchedulerCreateRange = {
  kind: SchedulerCreateKind
  rowTop: number
  rowHeight: number
  rowIndex: number
  startIndex: number
  endIndex: number
  assigneeId: string | null
}

export type SchedulerMarqueeStyle = {
  kind: SchedulerCreateKind
  left: number
  top: number
  width: number
  height: number
  assigneeId: string | null
}

export type SchedulerBoxRect = {
  startX: number
  startY: number
  endX: number
  endY: number
}

export type SchedulerBoxMarqueeStyle = {
  left: number
  top: number
  width: number
  height: number
}

export function rectsIntersect(
  selLeft: number,
  selRight: number,
  selTop: number,
  selBottom: number,
  cardLeft: number,
  cardRight: number,
  cardTop: number,
  cardBottom: number,
): boolean {
  return (
    cardLeft < selRight &&
    cardRight > selLeft &&
    cardTop < selBottom &&
    cardBottom > selTop
  )
}

export function isSchedulerInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest(`${SCHEDULE_INTERACTION_SELECTOR}, ${EDITABLE_TARGET_SELECTOR}`))
}

export function getSchedulerTimelinePoint(
  event: MousePointEvent,
  containerEl: HTMLElement,
  contentXOffset: number,
): { x: number; y: number } {
  const rect = containerEl.getBoundingClientRect()
  return {
    x: event.clientX - rect.left + containerEl.scrollLeft - contentXOffset,
    y: event.clientY - rect.top + containerEl.scrollTop,
  }
}

export function getSchedulerBoxMarqueeStyle(
  isBoxSelecting: boolean,
  selectionRect: SchedulerBoxRect | null,
): SchedulerBoxMarqueeStyle | null {
  if (!isBoxSelecting || !selectionRect) return null
  return {
    left: Math.min(selectionRect.startX, selectionRect.endX),
    top: Math.min(selectionRect.startY, selectionRect.endY),
    width: Math.abs(selectionRect.endX - selectionRect.startX),
    height: Math.abs(selectionRect.endY - selectionRect.startY),
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest(EDITABLE_TARGET_SELECTOR))
}

function getCreateRange(state: SchedulerCreateDragState): SchedulerCreateRange {
  return {
    kind: state.kind,
    rowTop: state.rowTop,
    rowHeight: state.rowHeight,
    rowIndex: state.rowIndex,
    startIndex: Math.min(state.startIndex, state.currentIndex),
    endIndex: Math.max(state.startIndex, state.currentIndex),
    assigneeId: state.assigneeId,
  }
}

function getCreateMarqueeStyle(
  dragState: SchedulerCreateDragState | null,
  pendingCreateMarquee: SchedulerCreateRange | null,
  cellWidth: number,
): SchedulerMarqueeStyle | null {
  const source = dragState ? getCreateRange(dragState) : pendingCreateMarquee
  if (!source) return null
  return {
    kind: source.kind,
    left: source.startIndex * cellWidth,
    top: source.rowTop,
    width: Math.max(cellWidth, (source.endIndex - source.startIndex + 1) * cellWidth),
    height: source.rowHeight,
    assigneeId: source.assigneeId,
  }
}

export function useScheduleCreateDrag({
  containerRef,
  contentXOffset,
  timelineWidth,
  cellWidth,
  pointToRow,
  xToIndex,
  clearSelection,
  onCreateRange,
}: {
  containerRef: RefObject<HTMLElement | null>
  contentXOffset: number
  timelineWidth: number
  cellWidth: number
  pointToRow: (x: number, y: number) => SchedulerTimelineRow | null
  xToIndex: (x: number) => number
  clearSelection: () => void
  onCreateRange: (range: SchedulerCreateRange) => void
}) {
  const dragRef = useRef<SchedulerCreateDragState | null>(null)
  const [dragState, setDragState] = useState<SchedulerCreateDragState | null>(null)
  const [pendingCreateMarquee, setPendingCreateMarquee] = useState<SchedulerCreateRange | null>(null)

  const beginCreateDrag = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const isCtrl = event.ctrlKey || event.metaKey
      const isAlt = event.altKey
      if (!isCtrl && !isAlt) return false

      const container = containerRef.current
      if (!container) return true

      const { x, y } = getSchedulerTimelinePoint(event, container, contentXOffset)
      const row = pointToRow(x, y)
      if (!row) return true
      if (isAlt && row.assigneeId == null) return true

      event.preventDefault()
      const index = xToIndex(Math.max(0, Math.min(timelineWidth - 1, x)))
      const next: SchedulerCreateDragState = {
        kind: isAlt ? 'leave' : 'schedule',
        startIndex: index,
        currentIndex: index,
        rowTop: row.top,
        rowHeight: row.height,
        rowIndex: row.rowIndex,
        assigneeId: row.assigneeId,
        active: false,
      }
      dragRef.current = next
      setDragState(next)
      clearSelection()
      return true
    },
    [clearSelection, containerRef, contentXOffset, pointToRow, timelineWidth, xToIndex],
  )

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return
      const container = containerRef.current
      if (!container) return

      const { x } = getSchedulerTimelinePoint(event, container, contentXOffset)
      const index = xToIndex(Math.max(0, Math.min(timelineWidth - 1, x)))
      const dx = Math.abs(index - dragRef.current.startIndex) * cellWidth
      const next: SchedulerCreateDragState = {
        ...dragRef.current,
        currentIndex: index,
        active: dragRef.current.active || dx > MARQUEE_ACTIVATE_PX,
      }
      dragRef.current = next
      setDragState(next)
    }

    const onMouseUp = () => {
      const current = dragRef.current
      if (!current) return

      if (current.active) {
        const range = getCreateRange(current)
        setPendingCreateMarquee(range)
        onCreateRange(range)
        queueMicrotask(() => setPendingCreateMarquee(null))
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
  }, [cellWidth, containerRef, contentXOffset, onCreateRange, timelineWidth, xToIndex])

  const handleCreateContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || dragRef.current) {
      event.preventDefault()
    }
  }, [])

  const createMarqueeStyle = useMemo(
    () => getCreateMarqueeStyle(dragState, pendingCreateMarquee, cellWidth),
    [cellWidth, dragState, pendingCreateMarquee],
  )

  return {
    dragState,
    beginCreateDrag,
    handleCreateContextMenu,
    createMarqueeStyle,
  }
}

export function useSchedulerBoxSelection({
  contentXOffset,
  getCardsInRect,
  getMultiDragUpdates,
}: {
  contentXOffset: number
  getCardsInRect: (rect: SchedulerBoxRect) => Set<string>
  getMultiDragUpdates: (deltaX: number, deltaY: number, selectedIds: Set<string>) => Schedule[] | null
}) {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [isBoxSelecting, setIsBoxSelecting] = useState(false)
  const [selectionRect, setSelectionRect] = useState<SchedulerBoxRect | null>(null)
  const [isMultiDragging, setIsMultiDragging] = useState(false)
  const [multiDragDeltaX, setMultiDragDeltaX] = useState(0)
  const [multiDragDeltaY, setMultiDragDeltaY] = useState(0)

  const selectionRectRef = useRef<SchedulerBoxRect | null>(null)
  const isBoxSelectingRef = useRef(false)
  const multiDragDeltaRef = useRef({ x: 0, y: 0 })

  const handleBoxSelectStart = useCallback(
    (event: MousePointEvent, containerEl: HTMLElement) => {
      const { x, y } = getSchedulerTimelinePoint(event, containerEl, contentXOffset)
      const next: SchedulerBoxRect = { startX: x, startY: y, endX: x, endY: y }
      selectionRectRef.current = next
      isBoxSelectingRef.current = true
      setSelectionRect(next)
      setSelectedCardIds(new Set())
      setIsBoxSelecting(true)
    },
    [contentXOffset],
  )

  const handleBoxSelectMove = useCallback(
    (event: MousePointEvent, containerEl: HTMLElement) => {
      if (!isBoxSelectingRef.current) return
      const { x, y } = getSchedulerTimelinePoint(event, containerEl, contentXOffset)
      const next: SchedulerBoxRect = {
        startX: selectionRectRef.current?.startX ?? x,
        startY: selectionRectRef.current?.startY ?? y,
        endX: x,
        endY: y,
      }
      selectionRectRef.current = next
      setSelectionRect(next)
      setSelectedCardIds(getCardsInRect(next))
    },
    [contentXOffset, getCardsInRect],
  )

  const handleBoxSelectEnd = useCallback(() => {
    isBoxSelectingRef.current = false
    setIsBoxSelecting(false)
    setSelectionRect(null)
    selectionRectRef.current = null
  }, [])

  const finishBoxSelect = useCallback(
    (event?: MousePointEvent, containerEl?: HTMLElement | null) => {
      if (!isBoxSelectingRef.current) return false
      if (event && containerEl) {
        handleBoxSelectMove(event, containerEl)
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
      return didDrag
    },
    [getCardsInRect, handleBoxSelectEnd, handleBoxSelectMove],
  )

  const handleMultiDragStart = useCallback(
    (scheduleId: string) => {
      if (!selectedCardIds.has(scheduleId)) return
      multiDragDeltaRef.current = { x: 0, y: 0 }
      setIsMultiDragging(true)
      setMultiDragDeltaX(0)
      setMultiDragDeltaY(0)
    },
    [selectedCardIds],
  )

  const handleMultiDragMove = useCallback((deltaX: number, deltaY: number) => {
    multiDragDeltaRef.current = { x: deltaX, y: deltaY }
    setMultiDragDeltaX(deltaX)
    setMultiDragDeltaY(deltaY)
  }, [])

  const handleMultiDragEnd = useCallback(
    (deltaX: number, deltaY: number) => {
      const finalDeltaX = multiDragDeltaRef.current.x || deltaX
      const finalDeltaY = multiDragDeltaRef.current.y || deltaY
      setIsMultiDragging(false)
      setMultiDragDeltaX(0)
      setMultiDragDeltaY(0)
      multiDragDeltaRef.current = { x: 0, y: 0 }
      if (finalDeltaX === 0 && finalDeltaY === 0) return null
      return getMultiDragUpdates(finalDeltaX, finalDeltaY, selectedCardIds)
    },
    [getMultiDragUpdates, selectedCardIds],
  )

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

  return {
    selectedCardIds,
    isBoxSelecting,
    selectionRect,
    isMultiDragging,
    multiDragDeltaX,
    multiDragDeltaY,
    handleBoxSelectStart,
    handleBoxSelectMove,
    handleBoxSelectEnd,
    finishBoxSelect,
    handleMultiDragStart,
    handleMultiDragMove,
    handleMultiDragEnd,
    clearSelection,
    isCardSelected,
  }
}

export function useScheduleDeleteFlow({
  schedules,
  selectedScheduleId,
  selectedCardCount,
  peekPageId,
  workspaceId,
  clearSelection,
  selectSchedule,
  openSchedulePage,
  deleteSchedule,
}: {
  schedules: Schedule[]
  selectedScheduleId: string | null
  selectedCardCount: number
  peekPageId: string | null
  workspaceId: string
  clearSelection: () => void
  selectSchedule: (id: string | null) => void
  openSchedulePage: (id: string) => void
  deleteSchedule: (id: string, workspaceId: string) => Promise<void>
}) {
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<Schedule | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (peekPageId || isEditableTarget(event.target)) return

      if (event.key === 'Escape' && selectedCardCount > 0) {
        clearSelection()
        return
      }

      if (!selectedScheduleId) return
      const selected = schedules.find((schedule) => schedule.id === selectedScheduleId)
      if (!selected) return

      if (event.key === 'Enter') {
        event.preventDefault()
        openSchedulePage(selected.id)
        return
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        setDeleteConfirmTarget(selected)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection, openSchedulePage, peekPageId, schedules, selectedCardCount, selectedScheduleId])

  const cancelDelete = useCallback(() => setDeleteConfirmTarget(null), [])

  const confirmDelete = useCallback(() => {
    const target = deleteConfirmTarget
    if (!target) return
    setDeleteConfirmTarget(null)
    selectSchedule(null)
    clearSelection()
    void deleteSchedule(target.id, workspaceId).catch((error) => {
      console.error(error)
      window.alert('일정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    })
  }, [clearSelection, deleteConfirmTarget, deleteSchedule, selectSchedule, workspaceId])

  return {
    deleteConfirmTarget,
    cancelDelete,
    confirmDelete,
  }
}

export function SchedulerCreateMarquee({ style }: { style: SchedulerMarqueeStyle | null }) {
  if (!style) return null
  return (
    <div
      className="absolute border-2 border-dashed pointer-events-none rounded-sm"
      style={{
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        borderColor:
          style.kind === 'leave'
            ? '#ef4444'
            : style.assigneeId == null
              ? '#f59e0b'
              : '#3b82f6',
        backgroundColor:
          style.kind === 'leave'
            ? 'rgb(252 165 165 / 0.25)'
            : style.assigneeId == null
              ? 'rgb(251 191 36 / 0.25)'
              : 'rgb(147 197 253 / 0.25)',
        zIndex: 100,
      }}
    />
  )
}

export function SchedulerBoxMarquee({ style }: { style: SchedulerBoxMarqueeStyle | null }) {
  if (!style) return null
  return (
    <div
      className="absolute border-2 border-blue-400 bg-blue-400/15 rounded-sm pointer-events-none"
      style={{
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        zIndex: 90,
      }}
    />
  )
}

export function ScheduleDeleteConfirmDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: Schedule | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <SimpleConfirmDialog
      open={target !== null}
      title="일정 삭제"
      message={`"${target?.title || '제목 없음'}" 일정을 삭제하시겠습니까?`}
      confirmLabel="삭제"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
