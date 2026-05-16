// 빈 영역 Shift+드래그로 여러 카드를 동시 선택하는 훅.
// 원본: TeamScheduler/src/components/schedule/useBoxSelection.ts 를 QuickNote 타입으로 번역.
import { useState, useCallback, useRef } from "react";
import type { Schedule } from "../../../store/schedulerStore";
import type { Member } from "../../../store/memberStore";
import { getRowHeight } from "../../../lib/scheduler/grid";
import { dateToX, widthForRange } from "../../../lib/scheduler/gridUtils";
import { parseIsoDate, toIsoEndOfDay, toIsoStartOfDay } from "../../../lib/scheduler/dateUtils";
import { hasCollision } from "../../../lib/scheduler/collisionDetection";

// 선택 사각형 (스크롤 보정된 컨테이너 내 픽셀 좌표)
export interface BoxSelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

// 두 AABB 사각형의 교차 여부
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
  return (
    cardLeft < selRight &&
    cardRight > selLeft &&
    cardTop < selBottom &&
    cardBottom > selTop
  );
}

export interface UseBoxSelectionOptions {
  // 표시 중인 멤버 목록 (순서 = 행 순서)
  visibleMembers: Member[];
  // 멤버별 일정 맵
  schedulesByMember: Record<string, Schedule[]>;
  // 현재 연도
  currentYear: number;
  // 셀 너비 (px)
  cellWidth: number;
  // 줌 레벨 (행 높이 계산용)
  zoomLevel: number;
  // 멤버별 실제 행 수 계산 함수
  rowCountForMember: (memberId: string, schedules: Schedule[]) => number;
  // 특이사항 행 수
  globalRowCount: number;
  // 특이사항 행 표시 여부
  showGlobalRow: boolean;
  // DateAxis 높이 (px) — 스크롤 컨테이너 내부 콘텐츠 상단 오프셋
  dateAxisHeight: number;
}

export interface UseBoxSelectionReturn {
  selectedCardIds: Set<string>;
  isBoxSelecting: boolean;
  selectionRect: BoxSelectionRect | null;
  isMultiDragging: boolean;
  multiDragDeltaX: number;
  multiDragDeltaY: number;
  handleBoxSelectStart: (e: React.MouseEvent, containerEl: HTMLElement) => void;
  handleBoxSelectMove: (e: React.MouseEvent, containerEl: HTMLElement) => void;
  handleBoxSelectEnd: () => void;
  handleMultiDragStart: (leaderScheduleId: string) => void;
  handleMultiDragMove: (deltaX: number, deltaY: number) => void;
  handleMultiDragEnd: (deltaX: number, deltaY: number) => Schedule[] | null;
  clearSelection: () => void;
  isCardSelected: (scheduleId: string) => boolean;
}

export function useBoxSelection(options: UseBoxSelectionOptions): UseBoxSelectionReturn {
  const {
    visibleMembers,
    schedulesByMember,
    currentYear,
    cellWidth,
    zoomLevel,
    rowCountForMember,
    globalRowCount,
    showGlobalRow,
    dateAxisHeight,
  } = options;

  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<BoxSelectionRect | null>(null);
  const [isMultiDragging, setIsMultiDragging] = useState(false);
  const [multiDragDeltaX, setMultiDragDeltaX] = useState(0);
  const [multiDragDeltaY, setMultiDragDeltaY] = useState(0);

  // selectionRect ref — 클로저 stale 방지
  const selectionRectRef = useRef<BoxSelectionRect | null>(null);
  const leaderIdRef = useRef<string | null>(null);
  const multiDragDeltaRef = useRef({ x: 0, y: 0 });

  // 선택 사각형 내에 있는 카드 ID 수집 (AABB 교차 검사)
  const getCardsInRect = useCallback(
    (rect: BoxSelectionRect): Set<string> => {
      const result = new Set<string>();

      // 사각형 정규화 (start < end 보장)
      const selLeft = Math.min(rect.startX, rect.endX);
      const selRight = Math.max(rect.startX, rect.endX);
      const selTop = Math.min(rect.startY, rect.endY);
      const selBottom = Math.max(rect.startY, rect.endY);

      // 콘텐츠 내 멤버 영역 Y 오프셋 누적
      let groupYOffset = dateAxisHeight;

      // 특이사항 행 스킵
      if (showGlobalRow) {
        const globalH = getRowHeight(globalRowCount, zoomLevel);
        // 특이사항 카드는 박스 선택 범위에서 제외 (원본도 멤버 카드만 선택)
        groupYOffset += globalH;
      }

      // 멤버별 일정 카드 검사
      for (const member of visibleMembers) {
        const memberSchedules = schedulesByMember[member.memberId] ?? [];
        const rowCount = rowCountForMember(member.memberId, memberSchedules);
        const rowH = getRowHeight(rowCount, zoomLevel);
        const slotH = rowCount > 0 ? rowH / rowCount : rowH;

        for (const schedule of memberSchedules) {
          const startDate = parseIsoDate(schedule.startAt);
          const endDate = parseIsoDate(schedule.endAt);
          const cardX = dateToX(currentYear, startDate, cellWidth);
          const cardW = widthForRange(startDate, endDate, cellWidth);
          const rowIdx = schedule.rowIndex ?? 0;
          const cardTop = groupYOffset + rowIdx * slotH;
          const cardBottom = cardTop + slotH;
          const cardLeft = cardX;
          const cardRight = cardX + cardW;

          if (
            rectsIntersect(
              selLeft, selRight, selTop, selBottom,
              cardLeft, cardRight, cardTop, cardBottom,
            )
          ) {
            result.add(schedule.id);
          }
        }

        groupYOffset += rowH;
      }

      return result;
    },
    [
      visibleMembers,
      schedulesByMember,
      currentYear,
      cellWidth,
      zoomLevel,
      rowCountForMember,
      globalRowCount,
      showGlobalRow,
      dateAxisHeight,
    ],
  );

  // 박스 선택 시작
  const handleBoxSelectStart = useCallback(
    (e: React.MouseEvent, containerEl: HTMLElement) => {
      const rect = containerEl.getBoundingClientRect();
      // 스크롤 보정 좌표
      const x = e.clientX - rect.left + containerEl.scrollLeft;
      const y = e.clientY - rect.top + containerEl.scrollTop;

      const newRect: BoxSelectionRect = { startX: x, startY: y, endX: x, endY: y };
      selectionRectRef.current = newRect;
      setIsBoxSelecting(true);
      setSelectionRect(newRect);
      setSelectedCardIds(new Set());
    },
    [],
  );

  // 박스 선택 이동 (실시간 카드 하이라이트 갱신)
  const handleBoxSelectMove = useCallback(
    (e: React.MouseEvent, containerEl: HTMLElement) => {
      if (!isBoxSelecting) return;

      const rect = containerEl.getBoundingClientRect();
      const x = e.clientX - rect.left + containerEl.scrollLeft;
      const y = e.clientY - rect.top + containerEl.scrollTop;

      const newRect: BoxSelectionRect = {
        startX: selectionRectRef.current?.startX ?? x,
        startY: selectionRectRef.current?.startY ?? y,
        endX: x,
        endY: y,
      };

      selectionRectRef.current = newRect;
      setSelectionRect(newRect);

      // 실시간으로 사각형 내 카드 선택
      const cardsInRect = getCardsInRect(newRect);
      setSelectedCardIds(cardsInRect);
    },
    [isBoxSelecting, getCardsInRect],
  );

  // 박스 선택 종료 (선택 ID 유지)
  const handleBoxSelectEnd = useCallback(() => {
    setIsBoxSelecting(false);
    setSelectionRect(null);
    selectionRectRef.current = null;
  }, []);

  const handleMultiDragStart = useCallback(
    (leaderScheduleId: string) => {
      if (!selectedCardIds.has(leaderScheduleId)) return;
      leaderIdRef.current = leaderScheduleId;
      multiDragDeltaRef.current = { x: 0, y: 0 };
      setIsMultiDragging(true);
      setMultiDragDeltaX(0);
      setMultiDragDeltaY(0);
    },
    [selectedCardIds],
  );

  const handleMultiDragMove = useCallback((deltaX: number, deltaY: number) => {
    multiDragDeltaRef.current = { x: deltaX, y: deltaY };
    setMultiDragDeltaX(deltaX);
    setMultiDragDeltaY(deltaY);
  }, []);

  const handleMultiDragEnd = useCallback(
    (deltaX: number, deltaY: number): Schedule[] | null => {
      const finalDeltaX = multiDragDeltaRef.current.x || deltaX;
      const finalDeltaY = multiDragDeltaRef.current.y || deltaY;
      setIsMultiDragging(false);
      setMultiDragDeltaX(0);
      setMultiDragDeltaY(0);
      leaderIdRef.current = null;
      multiDragDeltaRef.current = { x: 0, y: 0 };

      const daysMove = Math.round(finalDeltaX / cellWidth);
      if (daysMove === 0 && finalDeltaY === 0) {
        return null;
      }

      const allSchedules = visibleMembers.flatMap((member) => schedulesByMember[member.memberId] ?? []);
      const updatedSchedules: Schedule[] = [];
      const stationarySchedules = allSchedules.filter((schedule) => !selectedCardIds.has(schedule.id));

      for (const member of visibleMembers) {
        const memberSchedules = schedulesByMember[member.memberId] ?? [];
        const rowCount = rowCountForMember(member.memberId, memberSchedules);
        const slotHeight = rowCount > 0 ? getRowHeight(rowCount, zoomLevel) / rowCount : 0;
        const rowDelta = slotHeight > 0 ? Math.round(finalDeltaY / slotHeight) : 0;

        for (const schedule of memberSchedules) {
          if (!selectedCardIds.has(schedule.id)) continue;
          const start = parseIsoDate(schedule.startAt);
          const end = parseIsoDate(schedule.endAt);
          start.setDate(start.getDate() + daysMove);
          end.setDate(end.getDate() + daysMove);
          const preferredRowIndex = Math.max(0, Math.min(rowCount - 1, (schedule.rowIndex ?? 0) + rowDelta));
          updatedSchedules.push({
            ...schedule,
            startAt: toIsoStartOfDay(start),
            endAt: toIsoEndOfDay(end),
            rowIndex: preferredRowIndex,
          });
        }
      }
      for (const updated of updatedSchedules) {
        if (hasCollision(updated, stationarySchedules)) {
          return null;
        }
      }

      return updatedSchedules;
    },
    [
      cellWidth,
      rowCountForMember,
      schedulesByMember,
      selectedCardIds,
      visibleMembers,
      zoomLevel,
    ],
  );

  // 선택 초기화
  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set());
    setIsMultiDragging(false);
    setMultiDragDeltaX(0);
    setMultiDragDeltaY(0);
    leaderIdRef.current = null;
    multiDragDeltaRef.current = { x: 0, y: 0 };
  }, []);

  // 특정 카드 선택 여부 확인
  const isCardSelected = useCallback(
    (scheduleId: string): boolean => selectedCardIds.has(scheduleId),
    [selectedCardIds],
  );

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
    handleMultiDragStart,
    handleMultiDragMove,
    handleMultiDragEnd,
    clearSelection,
    isCardSelected,
  };
}
