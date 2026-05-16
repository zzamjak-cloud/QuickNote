// 일정 카드 — react-rnd로 드래그(이동)·리사이즈(좌우) 지원.
// Phase 2: x축 드래그 이동 + 좌/우 핸들 리사이즈. 수직 이동 비활성.
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { ExternalLink } from "lucide-react";
import type { Schedule } from "../../store/schedulerStore";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useMemberStore } from "../../store/memberStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { dateToX, widthForRange, xToDate } from "../../lib/scheduler/gridUtils";
import { CARD_MARGIN } from "../../lib/scheduler/grid";
import { daysInYear, parseIsoDate, toIsoStartOfDay, toIsoEndOfDay } from "../../lib/scheduler/dateUtils";
import { hasCollision } from "../../lib/scheduler/collisionDetection";
import { ANNUAL_LEAVE_COLOR, pickTextColor } from "../../lib/scheduler/colors";
import { ContextMenu } from "./ContextMenu";

type Props = {
  schedule: Schedule;
  year: number;
  cellWidth: number;
  rowHeight: number;
  rowCount: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  isMultiSelected?: boolean;
  multiDragDeltaX?: number | null;
  multiDragDeltaY?: number | null;
  onMultiDragStart?: () => void;
  onMultiDragMove?: (deltaX: number, deltaY: number) => void;
  onMultiDragEnd?: (deltaX: number, deltaY: number) => void;
};

type TooltipPos = { top: number; left: number };

export function ScheduleCard({
  schedule,
  year,
  cellWidth,
  rowHeight,
  rowCount,
  isSelected,
  onSelect,
  onEdit,
  isMultiSelected = false,
  multiDragDeltaX = null,
  multiDragDeltaY = null,
  onMultiDragStart,
  onMultiDragMove,
  onMultiDragEnd,
}: Props) {
  const updateSchedule = useSchedulerStore((s) => s.updateSchedule);
  const createSchedule = useSchedulerStore((s) => s.createSchedule);
  const members = useMemberStore((s) => s.members);
  const projects = useSchedulerProjectsStore((s) => s.projects);

  const startDate = parseIsoDate(schedule.startAt);
  const endDate = parseIsoDate(schedule.endAt);

  // 절대 좌표 계산
  const x = dateToX(year, startDate, cellWidth);
  const w = widthForRange(startDate, endDate, cellWidth);
  const rowIdx = schedule.rowIndex ?? 0;
  const slotHeight = rowCount > 0 ? rowHeight / rowCount : rowHeight;
  const y = rowIdx * slotHeight;

  const isAnnualLeave = schedule.title === "연차" || schedule.color === ANNUAL_LEAVE_COLOR;
  const isPast = !isAnnualLeave && endDate.getTime() < Date.now();
  const color = isAnnualLeave
    ? ANNUAL_LEAVE_COLOR
    : isPast
      ? "#9ca3af"
      : (schedule.color ?? "#3498DB");
  const textColor = schedule.textColor ?? "#ffffff";
  const project = schedule.projectId
    ? projects.find((item) => item.id === schedule.projectId) ?? null
    : null;

  // 드래그/리사이즈 중 로컬 위치 상태 (mouseup 전까지 서버 호출 안 함)
  const [localX, setLocalX] = useState<number>(x);
  const [localW, setLocalW] = useState<number>(w);
  const [localY, setLocalY] = useState<number>(y);

  // 드래그가 실제 이동이었는지 판별 (클릭 vs 드래그 구분)
  const dragMovedRef = useRef(false);
  const isShiftDragRef = useRef(false);
  const resizeStartRef = useRef<{ startIdx: number; endIdx: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<TooltipPos | null>(null);

  // schedule prop이 바뀌면 로컬 상태도 동기화
  const prevScheduleIdRef = useRef(schedule.id);
  if (prevScheduleIdRef.current !== schedule.id) {
    prevScheduleIdRef.current = schedule.id;
    setLocalX(x);
    setLocalW(w);
    setLocalY(y);
  }

  // 서버 날짜가 바뀌면(드래그 완료 후 서버 응답) 로컬 상태 갱신
  const prevStartAt = useRef(schedule.startAt);
  const prevEndAt = useRef(schedule.endAt);
  const prevRowIndex = useRef(schedule.rowIndex ?? 0);
  if (
    prevStartAt.current !== schedule.startAt ||
    prevEndAt.current !== schedule.endAt ||
    prevRowIndex.current !== (schedule.rowIndex ?? 0)
  ) {
    prevStartAt.current = schedule.startAt;
    prevEndAt.current = schedule.endAt;
    prevRowIndex.current = schedule.rowIndex ?? 0;
    setLocalX(x);
    setLocalW(w);
    setLocalY(y);
  }

  // 호버 시 툴팁 위치 계산
  const rndRef = useRef<Rnd>(null);

  const handleMouseEnter = useCallback(() => {
    // rnd 내부 DOM에서 위치 계산
    const el = rndRef.current?.getSelfElement();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const TOOLTIP_HEIGHT = 80;
    const GAP = 6;
    let top = rect.top - TOOLTIP_HEIGHT - GAP;
    if (top < 4) top = rect.bottom + GAP;
    setTooltipPos({ top, left: rect.left });
  }, []);

  const handleMouseLeave = useCallback(() => setTooltipPos(null), []);

  const findAvailableRowIndex = useCallback(
    (startAt: string, endAt: string, preferredRowIndex: number) => {
      const schedules = useSchedulerStore.getState().schedules;
      const tryRow = (rowIndex: number) => {
        const candidate: Schedule = {
          ...schedule,
          startAt,
          endAt,
          rowIndex,
        };
        return !hasCollision(candidate, schedules);
      };

      if (tryRow(preferredRowIndex)) return preferredRowIndex;
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        if (rowIndex === preferredRowIndex) continue;
        if (tryRow(rowIndex)) return rowIndex;
      }
      return null;
    },
    [rowCount, schedule],
  );

  // 드래그 시작 시 이동 여부 초기화
  const handleDragStart = useCallback((e: unknown) => {
    dragMovedRef.current = false;
    setTooltipPos(null);
    setContextMenuPos(null);
    if (typeof e === "object" && e && "shiftKey" in e) {
      isShiftDragRef.current = Boolean((e as { shiftKey?: boolean }).shiftKey);
    }
    if (isMultiSelected) {
      onMultiDragStart?.();
    }
  }, [isMultiSelected, onMultiDragStart]);

  // 드래그 중에는 자유롭게 따라가고, 드롭 시점에만 셀/행으로 스냅한다.
  const handleDrag = useCallback((_e: unknown, data: { x: number; y: number }) => {
    dragMovedRef.current = true;
    if (isMultiSelected) {
      const adjustedX = data.x - CARD_MARGIN;
      const adjustedY = data.y - CARD_MARGIN;
      const deltaX = adjustedX - x;
      const deltaY = adjustedY - y;
      onMultiDragMove?.(deltaX, deltaY);
      return;
    }
    setLocalX(data.x - CARD_MARGIN);
    setLocalY(data.y - CARD_MARGIN);
  }, [isMultiSelected, onMultiDragMove, x, y]);

  // 드래그 완료 — 이동이 있었을 때만 서버 업데이트
  const handleDragStop = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      if (!dragMovedRef.current) {
        // 실제 이동 없음 → 클릭으로 처리
        onSelect(schedule.id);
        return;
      }
      if (isMultiSelected) {
        const deltaX = multiDragDeltaX ?? 0;
        const deltaY = multiDragDeltaY ?? 0;
        onMultiDragEnd?.(deltaX, deltaY);
        return;
      }
      const wasShiftDrag = isShiftDragRef.current;
      isShiftDragRef.current = false;
      const adjustedX = data.x - CARD_MARGIN;
      const adjustedY = data.y - CARD_MARGIN;
      const snappedX = Math.round(adjustedX / cellWidth) * cellWidth;
      const snappedY = Math.round(adjustedY / slotHeight) * slotHeight;
      const newStart = xToDate(year, snappedX, cellWidth);
      // 기존 기간(일 수) 유지하여 종료일 계산
      const origStartMs = parseIsoDate(schedule.startAt).getTime();
      const origEndMs = parseIsoDate(schedule.endAt).getTime();
      const durationMs = origEndMs - origStartMs;
      const newEndMs = newStart.getTime() + durationMs;
      const newEnd = new Date(newEndMs);

      const newStartIso = toIsoStartOfDay(newStart);
      const newEndIso = toIsoEndOfDay(newEnd);
      const preferredRowIndex = Math.max(0, Math.min(rowCount - 1, Math.round(snappedY / slotHeight)));
      const newRowIndex = findAvailableRowIndex(newStartIso, newEndIso, preferredRowIndex);
      if (newRowIndex == null) {
        setLocalX(x);
        setLocalY(y);
        return;
      }

      // 로컬 상태 즉시 반영
      const nextLocalX = dateToX(year, newStart, cellWidth);
      const nextLocalW = widthForRange(newStart, newEnd, cellWidth);
      const nextLocalY = newRowIndex * slotHeight;

      if (wasShiftDrag) {
        void createSchedule({
          workspaceId: schedule.workspaceId,
          title: schedule.title,
          comment: schedule.comment ?? null,
          link: schedule.link ?? null,
          projectId: schedule.projectId ?? null,
          assigneeId: schedule.assigneeId ?? null,
          color: schedule.color ?? null,
          textColor: schedule.textColor ?? null,
          startAt: newStartIso,
          endAt: newEndIso,
          rowIndex: newRowIndex,
        });
        setLocalX(x);
        setLocalW(w);
        setLocalY(y);
        return;
      }

      setLocalX(nextLocalX);
      setLocalW(nextLocalW);
      setLocalY(nextLocalY);

      updateSchedule({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        startAt: newStartIso,
        endAt: newEndIso,
        rowIndex: newRowIndex,
      }).catch(() => {
        // 실패 시 원래 위치로 복구
        setLocalX(x);
        setLocalW(w);
        setLocalY(y);
      });
    },
    [
      schedule,
      year,
      cellWidth,
      findAvailableRowIndex,
      rowCount,
      slotHeight,
      x,
      y,
      w,
      isMultiSelected,
      createSchedule,
      multiDragDeltaX,
      multiDragDeltaY,
      onMultiDragEnd,
      onSelect,
      updateSchedule,
    ],
  );

  const handleResizeStart = useCallback(() => {
    const startIdx = Math.round(x / cellWidth);
    const endIdx = Math.max(startIdx, Math.round((x + w) / cellWidth) - 1);
    resizeStartRef.current = { startIdx, endIdx };
    setTooltipPos(null);
    setContextMenuPos(null);
  }, [cellWidth, w, x]);

  // 리사이즈 완료 — 시작 시점의 정수 셀 경계를 기준으로 한쪽 경계를 고정한다.
  const handleResizeStop = useCallback(
    (
      _e: unknown,
      direction: string,
      _ref: HTMLElement,
      delta: { width: number },
      _position: { x: number },
    ) => {
      const start = resizeStartRef.current ?? {
        startIdx: Math.round(x / cellWidth),
        endIdx: Math.max(Math.round(x / cellWidth), Math.round((x + w) / cellWidth) - 1),
      };
      const totalDays = daysInYear(year);
      const cellDelta = Math.round(delta.width / cellWidth);
      const nextStartIdx = direction.includes("left")
        ? Math.max(0, Math.min(start.endIdx, start.startIdx - cellDelta))
        : start.startIdx;
      const nextEndIdx = direction.includes("left")
        ? start.endIdx
        : Math.max(start.startIdx, Math.min(totalDays - 1, start.endIdx + cellDelta));
      const nextX = nextStartIdx * cellWidth;
      const nextW = Math.max(cellWidth, (nextEndIdx - nextStartIdx + 1) * cellWidth);

      const newStart = xToDate(year, nextStartIdx * cellWidth, cellWidth);
      const newEnd = xToDate(year, nextEndIdx * cellWidth, cellWidth);
      const newStartIso = toIsoStartOfDay(newStart);
      const newEndIso = toIsoEndOfDay(newEnd);

      const nextSchedule: Schedule = {
        ...schedule,
        startAt: newStartIso,
        endAt: newEndIso,
      };
      if (hasCollision(nextSchedule, useSchedulerStore.getState().schedules)) {
        setLocalX(x);
        setLocalW(w);
        resizeStartRef.current = null;
        return;
      }

      setLocalX(nextX);
      setLocalW(nextW);
      resizeStartRef.current = null;

      updateSchedule({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        startAt: newStartIso,
        endAt: newEndIso,
      }).catch(() => {
        // 실패 시 원래 크기로 복구
        setLocalX(x);
        setLocalW(w);
        resizeStartRef.current = null;
      });
    },
    [schedule, year, cellWidth, x, w, updateSchedule],
  );

  const baseX = isMultiSelected ? x : localX;
  const baseY = isMultiSelected ? y : localY;
  const effectiveX = multiDragDeltaX != null ? x + multiDragDeltaX : baseX;
  const effectiveY = multiDragDeltaY != null ? y + multiDragDeltaY : baseY;

  const handleColorChange = useCallback(
    (color: string) => {
      void updateSchedule({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        color,
        textColor: pickTextColor(color),
      }).catch(() => {
        window.alert("색상 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      });
    },
    [schedule.id, schedule.workspaceId, updateSchedule],
  );

  const handleDuplicate = useCallback(() => {
    const schedules = useSchedulerStore.getState().schedules;
    const memberSchedules = schedules.filter((item) => item.assigneeId === schedule.assigneeId);
    let targetRowIndex = schedule.rowIndex ?? 0;
    const tryRow = (rowIndex: number) => {
      const candidate: Schedule = {
        ...schedule,
        id: `tmp-${schedule.id}`,
        rowIndex,
      };
      return !hasCollision(candidate, memberSchedules);
    };

    if (!tryRow(targetRowIndex)) {
      targetRowIndex = rowCount;
    }

    void createSchedule({
      workspaceId: schedule.workspaceId,
      title: schedule.title,
      comment: schedule.comment ?? null,
      link: schedule.link ?? null,
      projectId: schedule.projectId ?? null,
      assigneeId: schedule.assigneeId ?? null,
      color: schedule.color ?? null,
      textColor: schedule.textColor ?? null,
      startAt: schedule.startAt,
      endAt: schedule.endAt,
      rowIndex: targetRowIndex,
    }).catch(() => {
      window.alert("일정 복제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    });
  }, [createSchedule, rowCount, schedule]);

  const handleTransfer = useCallback(
    (targetMemberId: string) => {
      const schedules = useSchedulerStore.getState().schedules;
      const targetSchedules = schedules.filter((item) => item.assigneeId === targetMemberId);
      let targetRowIndex = 0;
      for (; targetRowIndex <= targetSchedules.length; targetRowIndex += 1) {
        const candidate: Schedule = {
          ...schedule,
          assigneeId: targetMemberId,
          rowIndex: targetRowIndex,
        };
        if (!hasCollision(candidate, schedules)) break;
      }

      void updateSchedule({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        assigneeId: targetMemberId,
        rowIndex: targetRowIndex,
      }).catch(() => {
        window.alert("업무 이관에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      });
    },
    [schedule, updateSchedule],
  );

  useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        handleDuplicate();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDuplicate, isSelected]);

  return (
    <>
      <Rnd
        ref={rndRef}
        // x축만 드래그 허용 (수직 이동 비활성)
        dragAxis={rowCount > 1 ? "both" : "x"}
        // 이동 중에는 자유 이동, 드롭 결과만 셀/행 기준으로 스냅한다.
        dragGrid={[1, 1]}
        resizeGrid={[cellWidth, 1]}
        minWidth={cellWidth - CARD_MARGIN * 2}
        // 위치·크기 (CARD_MARGIN 반영)
        position={{ x: effectiveX + CARD_MARGIN, y: effectiveY + CARD_MARGIN }}
        size={{ width: Math.max(0, localW - CARD_MARGIN * 2), height: Math.max(0, slotHeight - CARD_MARGIN * 2) }}
        // 좌우 리사이즈만 활성
        enableResizing={{ left: true, right: true, top: false, bottom: false, topLeft: false, topRight: false, bottomLeft: false, bottomRight: false }}
        // 이동·리사이즈 핸들러
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
        // 리사이즈 핸들 커서 스타일
        resizeHandleStyles={{
          left: { cursor: "ew-resize", width: 8, left: 0 },
          right: { cursor: "ew-resize", width: 8, right: 0 },
        }}
        // 위치 고정 (Rnd 내부 상태 무시, 우리 localX/localW가 진실)
        disableDragging={false}
        style={{ position: "absolute" }}
        className={`rounded-md select-none overflow-hidden border-2 transition-shadow cursor-move schedule-card ${
          isSelected || isMultiSelected
            ? "ring-2 ring-blue-500 border-white shadow-lg"
            : "border-transparent hover:border-white/40 hover:shadow-sm"
        }`}
        // 배경색·텍스트색·z-index
        // Rnd의 style prop은 wrapper div에 적용됨
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="w-full h-full flex items-center px-1.5 overflow-hidden"
          style={{ backgroundColor: color, color: textColor }}
          onMouseDown={() => {
            if (!isMultiSelected) {
              onSelect(schedule.id);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(schedule.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(schedule.id);
            setContextMenuPos({ left: e.clientX, top: e.clientY });
          }}
          onDoubleClick={() => onEdit(schedule.id)}
        >
          <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
            <span className="text-xs font-medium leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
              {schedule.title || "제목 없음"}
            </span>
            {project && localW >= cellWidth * 1.5 && (
              <span className="text-[10px] opacity-80 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                {project.name}
              </span>
            )}
          </div>
          {schedule.link && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(schedule.link ?? "", "_blank", "noopener,noreferrer");
              }}
              className="ml-1 p-0.5 rounded bg-black/25 hover:bg-black/35 transition-colors"
              title="링크 열기"
            >
              <ExternalLink size={10} />
            </button>
          )}
        </div>
      </Rnd>

      {/* 더블클릭 편집 — Rnd 외부 클릭 이벤트로 처리 */}
      {/* Rnd는 onDoubleClick을 직접 지원하지 않으므로 wrapper div 사용 */}
      {/* 단, Rnd가 pointer-events를 관리하므로 onDoubleClick은 Rnd의 children에서 처리 */}

      {/* 호버 툴팁 */}
      {tooltipPos !== null &&
        createPortal(
          <div
            className="fixed bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg px-3 py-2 z-[600] text-xs pointer-events-none"
            style={{ top: tooltipPos.top, left: tooltipPos.left, maxWidth: 240 }}
          >
            {project && (
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
                {project.name}
              </div>
            )}
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
              {schedule.title || "제목 없음"}
            </div>
            {schedule.comment && (
              <div className="text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed whitespace-pre-line">
                {schedule.comment}
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
            currentColor={color}
            onColorChange={handleColorChange}
            members={members}
            currentMemberId={schedule.assigneeId ?? null}
            onTransfer={schedule.assigneeId ? handleTransfer : undefined}
            onClose={() => setContextMenuPos(null)}
          />,
          document.body,
        )}
    </>
  );
}
