// 연간 365일 메인 그리드 — DateAxis + 멤버별 행 + ScheduleCard.
// 인터랙션:
//   Ctrl/Alt+드래그 → 점선 마퀴로 신규 일정 생성
//   Shift+드래그    → 파란 실선 마퀴로 다중 카드 박스 선택
//   클릭           → 카드 단일 선택 / 빈 영역 클릭 → 선택 해제
//   더블클릭        → DB 항목 페이지 피커
// 원본: TeamScheduler/src/components/schedule/ScheduleGrid.tsx 기반
import { useRef, useMemo, useCallback, useState, useEffect, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronsLeft, ChevronsRight, ClipboardList, Plus, Minus } from "lucide-react";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useMemberStore } from "../../store/memberStore";
import { useVisibleMembers } from "./hooks/useVisibleMembers";
import { useBoxSelection } from "./hooks/useBoxSelection";
import {
  daysInYear,
  dayIndex,
  todayIndex as calcTodayIndex,
  startOfYear,
  addDays,
  toIsoStartOfDay,
  toIsoEndOfDay,
} from "../../lib/scheduler/dateUtils";
import {
  getRowHeight,
  getCellWidth,
  CARD_MARGIN,
} from "../../lib/scheduler/grid";
import { computeRowCount } from "../../lib/scheduler/collisionDetection";
import { parseDateKey } from "../../lib/scheduler/mm/weekUtils";
import { DateAxis } from "./DateAxis";
import { GridRow } from "./GridRow";
import { ScheduleCard } from "./ScheduleCard";
import { SchedulerTaskColumnSettingsButton } from "./SchedulerTaskColumnSettingsButton";
import type { Schedule } from "../../store/schedulerStore";
import {
  ANNUAL_LEAVE_COLOR,
  DEFAULT_SCHEDULE_COLOR,
  pickTextColor,
} from "../../lib/scheduler/colors";
import { updateMemberApi } from "../../lib/sync/memberApi";
import { LC_SCHEDULER_ATTENDANCE_TITLE } from "../../lib/scheduler/database";
import { groupSchedulesByMember } from "../../lib/scheduler/selectors/scheduleSelectors";
import {
  buildVirtualRows,
  getVirtualRowsHeight,
  getVisibleVirtualRows,
} from "../../lib/scheduler/selectors/rowVirtualization";
import { useUiStore } from "../../store/uiStore";
import type { Member } from "../../store/memberStore";
import {
  PENDING_SCHEDULE_PAGE_ID_PREFIX,
  ScheduleDeleteConfirmDialog,
  SchedulerBoxMarquee,
  SchedulerCreateMarquee,
  getSchedulerBoxMarqueeStyle,
  isSchedulerInteractionTarget,
  useScheduleCreateDrag,
  useScheduleDeleteFlow,
  type SchedulerCreateRange,
} from "./hooks/scheduleInteractions";
import { useOpenSchedulePage } from "./useOpenSchedulePage";
import { useIsCompact } from "../../hooks/useViewport";

// DateAxis 고정 높이: 주간/월간 뷰와 동일한 40px + 36px
const DATE_AXIS_HEIGHT = 76;
const MEMBER_COLUMN_WIDTH = 120;

// 마지막 구성원도 화면 중앙 근처까지 올려 볼 수 있도록 하단 스크롤 여백을 둔다.
const TIMELINE_BOTTOM_SPACER_HEIGHT = "50vh";
const TIMELINE_ROW_OVERSCAN_PX = 720;

type Props = {
  workspaceId: string;
};

type MemberRowItem = {
  member: Member;
  memberSchedules: Schedule[];
  rowCount: number;
  rowHeight: number;
  cardRows: number;
  canRemove: boolean;
};

// 일 인덱스 → 날짜 ISO 문자열 변환
function dayIndexToDateIso(dayIdx: number, year: number, endOfDay = false): string {
  const base = startOfYear(year);
  const d = addDays(base, dayIdx);
  return endOfDay ? toIsoEndOfDay(d) : toIsoStartOfDay(d);
}

export function ScheduleGrid({ workspaceId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressContainerClickRef = useRef(false);

  const schedules = useSchedulerStore((s) => s.schedules);
  const createSchedule = useSchedulerStore((s) => s.createSchedule);
  const updateSchedule = useSchedulerStore((s) => s.updateSchedule);
  const deleteSchedule = useSchedulerStore((s) => s.deleteSchedule);
  const openPeek = useUiStore((s) => s.openPeek);
  const peekPageId = useUiStore((s) => s.peekPageId);
  const members = useMemberStore((s) => s.members);
  const {
    zoomLevel,
    columnWidthScale,
    currentYear,
    selectedMemberId,
    selectedProjectId,
    selectedScheduleId,
    multiSelectedIds,
    mmWeekStart,
    weekendColor,
    selectSchedule,
  } = useSchedulerViewStore(
    useShallow((s) => ({
      zoomLevel: s.zoomLevel,
      columnWidthScale: s.columnWidthScale,
      currentYear: s.currentYear,
      selectedMemberId: s.selectedMemberId,
      selectedProjectId: s.selectedProjectId,
      selectedScheduleId: s.selectedScheduleId,
      multiSelectedIds: s.multiSelectedIds,
      mmWeekStart: s.mmWeekStart,
      weekendColor: s.weekendColor,
      selectSchedule: s.selectSchedule,
    })),
  );

  // 마운트 시 1회 + 연도 변경 시에만 오늘 스크롤을 실행하기 위한 가드
  const didInitialScrollRef = useRef(false);
  const prevYearRef = useRef(currentYear);
  const prevCellWidthRef = useRef(0);

  // 컴팩트(모바일·태블릿): 구성원 컬럼 폴딩 — 타임라인 가로 공간 확보
  const isCompact = useIsCompact();
  const [memberColumnCollapsed, setMemberColumnCollapsed] = useState(false);
  const collapsedMemberColumn = isCompact && memberColumnCollapsed;
  const memberColumnWidth = collapsedMemberColumn ? 36 : MEMBER_COLUMN_WIDTH;

  // 멤버별 사용자 지정 행 수 (최소 1, 최대 10)
  const [memberRowCounts, setMemberRowCounts] = useState<Record<string, number>>({});

  // 특이사항 행 수 (별도 관리)
  const [globalRowCount, setGlobalRowCount] = useState(1);
  const [viewportState, setViewportState] = useState({ scrollTop: 0, scrollLeft: 0, height: 0 });

  useEffect(() => {
    const next: Record<string, number> = {};
    members.forEach((member) => {
      next[member.memberId] = Math.max(1, member.rowCount ?? 1);
    });
    setMemberRowCounts(next);
  }, [members]);

  const cellWidth = getCellWidth(zoomLevel, columnWidthScale);
  const todayIdx = calcTodayIndex(currentYear);
  const total = daysInYear(currentYear);
  const totalWidth = total * cellWidth;

  // 헤더의 조직/팀/프로젝트 선택값을 반영한 활성 멤버 목록
  const activeMembers = useVisibleMembers();

  // 탭·다중 선택까지 반영한 최종 표시 멤버 목록
  const visibleMembers = useMemo(() => {
    if (multiSelectedIds.length > 0) {
      return activeMembers.filter((m) => multiSelectedIds.includes(m.memberId));
    }
    if (selectedMemberId === null) return activeMembers;
    return activeMembers.filter((m) => m.memberId === selectedMemberId);
  }, [activeMembers, selectedMemberId, multiSelectedIds]);

  // 특이사항 행 노출 여부: 프로젝트가 선택된 경우에만 표시
  const showGlobalRow = selectedProjectId != null;
  const selectedProjectFilterId =
    selectedProjectId?.startsWith("proj:") ? selectedProjectId.slice(5) : null;

  // 구성원 일정은 고유 구성원 기준으로 모두 표시하고, 특이사항은 현재 선택된 스코프에 귀속된 것만 표시한다.
  const { schedulesByMember, globalSchedules } = useMemo(
    () => groupSchedulesByMember(schedules, selectedProjectId),
    [schedules, selectedProjectId],
  );

  // 멤버 실제 행 수 계산
  const rowCountForMember = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules);
      const userRows = memberRowCounts[memberId] ?? 1;
      return Math.max(cardRows, userRows);
    },
    [memberRowCounts],
  );

  const memberRowItems = useMemo<MemberRowItem[]>(() => (
    visibleMembers.map((member) => {
      const memberSchedules = schedulesByMember[member.memberId] ?? [];
      const rowCount = rowCountForMember(member.memberId, memberSchedules);
      const rowHeight = getRowHeight(rowCount, zoomLevel);
      const cardRows = computeRowCount(memberSchedules);
      return {
        member,
        memberSchedules,
        rowCount,
        rowHeight,
        cardRows,
        canRemove: (memberRowCounts[member.memberId] ?? 1) > Math.max(1, cardRows),
      };
    })
  ), [memberRowCounts, rowCountForMember, schedulesByMember, visibleMembers, zoomLevel]);

  const memberVirtualRows = useMemo(
    () => buildVirtualRows(memberRowItems, (item) => item.rowHeight),
    [memberRowItems],
  );
  const memberRowsHeight = useMemo(
    () => getVirtualRowsHeight(memberVirtualRows),
    [memberVirtualRows],
  );
  const globalRowHeight = showGlobalRow ? getRowHeight(globalRowCount, zoomLevel) : 0;
  const memberRowsTop = DATE_AXIS_HEIGHT + globalRowHeight;
  const bodyRowsHeight = globalRowHeight + memberRowsHeight;
  const contentMinHeight =
    visibleMembers.length > 0
      ? `calc(${DATE_AXIS_HEIGHT + bodyRowsHeight}px + max(240px, ${TIMELINE_BOTTOM_SPACER_HEIGHT}))`
      : DATE_AXIS_HEIGHT + 128;
  const normalizedViewportScrollTop = Math.min(
    Math.max(0, viewportState.scrollTop),
    Math.max(0, memberRowsTop + memberRowsHeight - viewportState.height),
  );
  const visibleMemberRows = useMemo(
    () => getVisibleVirtualRows(
      memberVirtualRows,
      Math.max(0, normalizedViewportScrollTop - memberRowsTop),
      viewportState.height,
      TIMELINE_ROW_OVERSCAN_PX,
    ),
    [memberRowsTop, memberVirtualRows, normalizedViewportScrollTop, viewportState.height],
  );

  // 행 추가 핸들러
  const handleAddRow = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules);
      const member = members.find((item) => item.memberId === memberId);
      const previousRowCount = member?.rowCount ?? memberRowCounts[memberId] ?? 1;
      const nextRowCount = Math.min(10, Math.max(previousRowCount, cardRows) + 1);

      setMemberRowCounts((prev) => ({ ...prev, [memberId]: nextRowCount }));
      useMemberStore.getState().upsertMember({
        ...(member ?? {
          memberId,
          email: "",
          name: "",
          jobRole: "",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "",
        }),
        rowCount: nextRowCount,
      });

      void updateMemberApi(memberId, { rowCount: nextRowCount }).catch(() => {
        setMemberRowCounts((prev) => ({ ...prev, [memberId]: previousRowCount }));
        if (member) {
          useMemberStore.getState().upsertMember({ ...member, rowCount: previousRowCount });
        }
        useUiStore.getState().showToast("행 개수 저장에 실패했습니다.", { kind: "error" });
      });
    },
    [memberRowCounts, members],
  );

  // 행 제거 핸들러
  const handleRemoveRow = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules);
      const member = members.find((item) => item.memberId === memberId);
      const previousRowCount = member?.rowCount ?? memberRowCounts[memberId] ?? 1;
      const nextRowCount = Math.max(1, cardRows, previousRowCount - 1);
      if (nextRowCount === previousRowCount) return;

      setMemberRowCounts((prev) => ({ ...prev, [memberId]: nextRowCount }));
      if (member) {
        useMemberStore.getState().upsertMember({ ...member, rowCount: nextRowCount });
      }

      void updateMemberApi(memberId, { rowCount: nextRowCount }).catch(() => {
        setMemberRowCounts((prev) => ({ ...prev, [memberId]: previousRowCount }));
        if (member) {
          useMemberStore.getState().upsertMember({ ...member, rowCount: previousRowCount });
        }
        useUiStore.getState().showToast("행 개수 저장에 실패했습니다.", { kind: "error" });
      });
    },
    [memberRowCounts, members],
  );

  // ── 박스 선택 훅 (Shift+드래그) ───────────────────────────────────────────
  const {
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
  } = useBoxSelection({
    visibleMembers,
    schedulesByMember,
    currentYear,
    cellWidth,
    zoomLevel,
    rowCountForMember,
    globalRowCount,
    showGlobalRow,
    dateAxisHeight: DATE_AXIS_HEIGHT,
    contentXOffset: memberColumnWidth,
  });

  const handleMultiDragComplete = useCallback(
    (deltaX: number, deltaY: number) => {
      const updatedSchedules = handleMultiDragEnd(deltaX, deltaY);
      if (!updatedSchedules) return;

      const prevSchedules = schedules.filter((schedule) => selectedCardIds.has(schedule.id));
      const prevScheduleMap = new Map(prevSchedules.map((schedule) => [schedule.id, schedule]));

      useSchedulerStore.setState((state) => ({
        schedules: state.schedules.map((schedule) => {
          const updated = updatedSchedules.find((item) => item.id === schedule.id);
          return updated ?? schedule;
        }),
      }));

      updatedSchedules.forEach((updated) => {
        void updateSchedule({
          id: updated.id,
          workspaceId: updated.workspaceId,
          startAt: updated.startAt,
          endAt: updated.endAt,
          rowIndex: updated.rowIndex ?? 0,
        }).catch(() => {
          const prev = prevScheduleMap.get(updated.id);
          if (!prev) return;
          useSchedulerStore.setState((state) => ({
            schedules: state.schedules.map((schedule) => (
              schedule.id === prev.id ? prev : schedule
            )),
          }));
          void updateSchedule({
            id: updated.id,
            workspaceId: updated.workspaceId,
            startAt: prev.startAt,
            endAt: prev.endAt,
            rowIndex: prev.rowIndex,
          });
        });
      });
    },
    [handleMultiDragEnd, schedules, selectedCardIds, updateSchedule],
  );

  const handleScheduleSelect = useCallback((id: string) => {
    selectSchedule(id);
    if (!isCardSelected(id)) {
      clearSelection();
    }
  }, [clearSelection, isCardSelected, selectSchedule]);

  const openSchedulePage = useOpenSchedulePage(workspaceId);

  const handleCreateRange = useCallback(
    (range: SchedulerCreateRange) => {
      const startAt = dayIndexToDateIso(range.startIndex, currentYear, false);
      const endAt = dayIndexToDateIso(range.endIndex, currentYear, true);

      if (range.kind === "leave" && range.assigneeId) {
        void createSchedule({
          workspaceId,
          title: LC_SCHEDULER_ATTENDANCE_TITLE,
          projectId: selectedProjectFilterId ?? null,
          assigneeId: range.assigneeId,
          selectedScopeKey: selectedProjectId,
          color: ANNUAL_LEAVE_COLOR,
          textColor: pickTextColor(ANNUAL_LEAVE_COLOR),
          startAt,
          endAt,
          rowIndex: range.rowIndex,
        }).catch((error) => {
          console.error(error);
          window.alert("근태 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        });
        return;
      }

      const pendingPeekPageId = `${PENDING_SCHEDULE_PAGE_ID_PREFIX}${Date.now()}`;
      openPeek(pendingPeekPageId);
      void createSchedule({
        workspaceId,
        title: "새 일정",
        projectId: selectedProjectFilterId ?? null,
        assigneeId: range.assigneeId,
        selectedScopeKey: selectedProjectId,
        color: DEFAULT_SCHEDULE_COLOR,
        textColor: pickTextColor(DEFAULT_SCHEDULE_COLOR),
        startAt,
        endAt,
        rowIndex: range.rowIndex,
      }).then((schedule) => {
        selectSchedule(schedule.id);
        const currentPeekPageId = useUiStore.getState().peekPageId;
        if (!currentPeekPageId || currentPeekPageId === pendingPeekPageId) {
          void openSchedulePage(schedule.id);
        }
      }).catch((error) => {
        console.error(error);
        if (useUiStore.getState().peekPageId === pendingPeekPageId) {
          useUiStore.getState().closePeek();
        }
        window.alert("일정 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      });
    },
    [
      createSchedule,
      currentYear,
      openPeek,
      openSchedulePage,
      selectSchedule,
      selectedProjectFilterId,
      selectedProjectId,
      workspaceId,
    ],
  );

  // "+ 작업 추가" — 구성원 탭에서 오늘 날짜로 새 작업 생성(드래그 생성과 동일 경로)
  const handleAddTask = useCallback(() => {
    if (!selectedMemberId) return;
    const index = todayIdx ?? 0;
    handleCreateRange({
      kind: "schedule",
      rowTop: 0,
      rowHeight: 0,
      rowIndex: 0,
      startIndex: index,
      endIndex: index,
      assigneeId: selectedMemberId,
    });
  }, [handleCreateRange, selectedMemberId, todayIdx]);

  // 오늘로 스크롤
  const scrollToToday = useCallback(() => {
    if (!containerRef.current || todayIdx === null) return;
    const containerWidth = containerRef.current.clientWidth;
    const x = todayIdx * cellWidth;
    containerRef.current.scrollLeft = Math.max(0, x - containerWidth / 2);
  }, [todayIdx, cellWidth]);

  const syncViewportState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = {
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
      height: container.clientHeight,
    };
    setViewportState((prev) => (
      prev.scrollTop === next.scrollTop &&
      prev.scrollLeft === next.scrollLeft &&
      prev.height === next.height
        ? prev
        : next
    ));
  }, []);

  useEffect(() => {
    window.addEventListener("lc-scheduler:scroll-today", scrollToToday);
    return () => {
      window.removeEventListener("lc-scheduler:scroll-today", scrollToToday);
    };
  }, [scrollToToday]);

  useLayoutEffect(() => {
    syncViewportState();
  }, [
    cellWidth,
    currentYear,
    memberRowsHeight,
    syncViewportState,
    visibleMembers.length,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      syncViewportState();
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [syncViewportState]);

  // 마운트 시 1회 오늘로 자동 스크롤.
  // 연도 변경 시에도 재실행하되, 첫 페인트 전에 위치를 맞춰 초기 출렁임을 제거한다.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const prevCellWidth = prevCellWidthRef.current;
    const yearChanged = prevYearRef.current !== currentYear;
    const cellWidthChanged = prevCellWidth > 0 && prevCellWidth !== cellWidth;

    if (container && didInitialScrollRef.current && !yearChanged && cellWidthChanged) {
      const timelineViewportWidth = Math.max(0, container.clientWidth - memberColumnWidth);
      const anchorDay = (container.scrollLeft + timelineViewportWidth / 2) / prevCellWidth;
      container.scrollLeft = Math.max(0, anchorDay * cellWidth - timelineViewportWidth / 2);
      prevCellWidthRef.current = cellWidth;
      syncViewportState();
      return;
    }

    if (!didInitialScrollRef.current || yearChanged) {
      const apply = () => {
        scrollToToday();
        didInitialScrollRef.current = true;
        prevYearRef.current = currentYear;
        prevCellWidthRef.current = cellWidth;
        syncViewportState();
      };
      if (container && container.clientWidth > 0) {
        apply();
        return;
      }
      const id = requestAnimationFrame(apply);
      return () => cancelAnimationFrame(id);
    }
    prevCellWidthRef.current = cellWidth;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, cellWidth, syncViewportState]);

  // 빈 공간 클릭 시 선택 해제
  const handleContainerClick = useCallback(() => {
    if (suppressContainerClickRef.current) {
      suppressContainerClickRef.current = false;
      return;
    }
    selectSchedule(null);
    clearSelection();
  }, [selectSchedule, clearSelection]);

  // ── Ctrl/Alt + 드래그 마퀴 로직 ──────────────────────────────────────────

  const xToDayIndex = useCallback(
    (x: number) => Math.max(0, Math.min(total - 1, Math.floor(x / cellWidth))),
    [cellWidth, total],
  );

  // 좌표가 실제 타임라인 셀 안에 있는지 판정하고 행 정보를 반환
  const pointToScheduleRow = useCallback(
    (x: number, y: number): { top: number; height: number; rowIndex: number; assigneeId: string | null } | null => {
      if (x < 0 || x > totalWidth || y < DATE_AXIS_HEIGHT) return null;

      // 특이사항 행이 표시 중이면 먼저 확인
      if (showGlobalRow) {
        if (y < DATE_AXIS_HEIGHT + globalRowHeight) {
          const slotH = globalRowCount > 0 ? globalRowHeight / globalRowCount : globalRowHeight;
          const rowIndex = Math.max(0, Math.min(globalRowCount - 1, Math.floor((y - DATE_AXIS_HEIGHT) / slotH)));
          return { top: DATE_AXIS_HEIGHT + rowIndex * slotH, height: slotH, rowIndex, assigneeId: null };
        }
      }

      for (const row of memberVirtualRows) {
        const rowTop = memberRowsTop + row.top;
        if (y < rowTop + row.height) {
          const slotH = row.item.rowCount > 0 ? row.height / row.item.rowCount : row.height;
          const rowIndex = Math.max(0, Math.min(row.item.rowCount - 1, Math.floor((y - rowTop) / slotH)));
          return {
            top: rowTop + rowIndex * slotH,
            height: slotH,
            rowIndex,
            assigneeId: row.item.member.memberId,
          };
        }
      }
      return null;
    },
    [
      totalWidth,
      showGlobalRow,
      globalRowCount,
      globalRowHeight,
      memberRowsTop,
      memberVirtualRows,
    ],
  );

  const {
    dragState,
    beginCreateDrag,
    handleCreateContextMenu,
    createMarqueeStyle,
  } = useScheduleCreateDrag({
    containerRef,
    contentXOffset: memberColumnWidth,
    timelineWidth: totalWidth,
    cellWidth,
    pointToRow: pointToScheduleRow,
    xToIndex: xToDayIndex,
    clearSelection,
    onCreateRange: handleCreateRange,
  });

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
  });

  // 마우스 다운: 수정키에 따라 생성 드래그 또는 박스 선택 드래그로 분기
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target;
      if (isSchedulerInteractionTarget(target)) return;

      const container = containerRef.current;
      if (!container) return;

      if (beginCreateDrag(e)) return;

      e.preventDefault();
      handleBoxSelectStart(e, container);
    },
    [beginCreateDrag, handleBoxSelectStart],
  );

  // 마우스 이동: 박스 선택 이동 (Ctrl/Alt 이동은 window 이벤트에서 처리)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isBoxSelecting) {
        const container = containerRef.current;
        if (container) handleBoxSelectMove(e, container);
      }
    },
    [isBoxSelecting, handleBoxSelectMove],
  );

  // 마우스 업: 박스 선택 종료 (Ctrl/Alt 완료는 window 이벤트에서 처리)
  const handleMouseUp = useCallback(() => {
    if (isBoxSelecting) {
      const didDrag =
        selectionRect != null &&
        (Math.abs(selectionRect.endX - selectionRect.startX) > 2 ||
          Math.abs(selectionRect.endY - selectionRect.startY) > 2 ||
          selectedCardIds.size > 0);
      handleBoxSelectEnd();
      if (didDrag) {
        suppressContainerClickRef.current = true;
      }
    }
  }, [isBoxSelecting, handleBoxSelectEnd, selectedCardIds.size, selectionRect]);

  const boxMarqueeStyle = useMemo(() => {
    return getSchedulerBoxMarqueeStyle(isBoxSelecting, selectionRect);
  }, [isBoxSelecting, selectionRect]);

  const mmWeekIndicatorStyle = useMemo(() => {
    if (!mmWeekStart) return null;
    const start = parseDateKey(mmWeekStart);
    const end = addDays(start, 4);
    const startIdx = dayIndex(currentYear, start);
    const endIdx = dayIndex(currentYear, end);
    const clampedStart = Math.max(0, startIdx);
    const clampedEnd = Math.min(total - 1, endIdx);
    if (clampedEnd < 0 || clampedStart >= total || clampedStart > clampedEnd) return null;
    return {
      left: clampedStart * cellWidth + CARD_MARGIN,
      width: Math.max(2, (clampedEnd - clampedStart + 1) * cellWidth - CARD_MARGIN * 2),
    };
  }, [cellWidth, currentYear, mmWeekStart, total]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 본문: 단일 스크롤 컨테이너 + 좌측 sticky 컬럼 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleCreateContextMenu}
        style={{
          userSelect: (dragState || isBoxSelecting) ? "none" : undefined,
          overscrollBehaviorY: "none",
        }}
      >
        <div
          style={{
            width: totalWidth + memberColumnWidth,
            minWidth: totalWidth + memberColumnWidth,
            minHeight: contentMinHeight,
            position: "relative",
          }}
        >
          <div
            className={`sticky left-0 z-30 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${
              collapsedMemberColumn ? "overflow-hidden" : ""
            }`}
            style={{ width: memberColumnWidth }}
          >
            <div
              className={`sticky top-0 z-40 flex items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-1.5 ${
                collapsedMemberColumn ? "justify-center" : ""
              }`}
              style={{ height: DATE_AXIS_HEIGHT }}
            >
              {/* 컴팩트: 구성원 컬럼 폴딩 토글 */}
              {isCompact && (
                <button
                  type="button"
                  onClick={() => setMemberColumnCollapsed((v) => !v)}
                  aria-label={collapsedMemberColumn ? "구성원 컬럼 펼치기" : "구성원 컬럼 접기"}
                  className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {collapsedMemberColumn ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
                </button>
              )}
              {!collapsedMemberColumn && (
                <>
                  {/* 탭 제목 — 마일스톤/피처 A0 와 동일 방식 */}
                  <ClipboardList className="w-4 h-4 shrink-0 text-zinc-500" />
                  <span className="truncate text-sm font-semibold text-zinc-700 dark:text-zinc-200">작업</span>
                  <div className="ml-auto shrink-0">
                    <SchedulerTaskColumnSettingsButton workspaceId={workspaceId} />
                  </div>
                </>
              )}
            </div>

            <div>
          {/* 특이사항 행 — 프로젝트 선택 시에만 표시 */}
          {showGlobalRow && (() => {
            const globalH = getRowHeight(globalRowCount, zoomLevel);
            const globalCardRows = computeRowCount(globalSchedules);
            const canRemoveGlobal = globalRowCount > Math.max(1, globalCardRows);
            return (
              <div
                className="group relative border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center px-2 bg-amber-50/40 dark:bg-amber-950/20"
                style={{ height: globalH }}
              >
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400 truncate max-w-full text-center">
                  특이사항
                </span>
                {/* +/- 버튼 */}
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setGlobalRowCount((n) => Math.min(10, n + 1))}
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
                    disabled={!canRemoveGlobal}
                    className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                  >
                    <Minus size={10} />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 멤버 이름 + +/- 버튼 */}
          {memberRowsHeight > 0 && (
            <div style={{ height: memberRowsHeight, position: "relative" }}>
              {visibleMemberRows.map(({ item, top }) => (
              <div
                key={item.member.memberId}
                className="group absolute left-0 right-0 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center px-2"
                style={{ top, height: item.rowHeight }}
              >
                {/* 멤버 이름 — 셀 중앙 정렬 */}
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-full text-center">
                  {item.member.name}
                </span>

                {/* +/- 버튼 — 절대위치 우측 하단, 호버 시만 표시 */}
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
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
          )}

            </div>
            {/* 작업 추가 — 구성원 1명 탭 선택 시에만 표시 (통합탭 제외) */}
            {selectedMemberId && (
              <button
                type="button"
                onClick={handleAddTask}
                title="작업 추가"
                className={`flex h-11 w-full items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 ${
                  collapsedMemberColumn ? "justify-center" : "justify-end pr-3"
                }`}
              >
                <Plus size={12} className="shrink-0" />
                {!collapsedMemberColumn && "작업 추가"}
              </button>
            )}
          </div>
          <div
            style={{
              width: totalWidth,
              minWidth: totalWidth,
              position: "absolute",
              top: 0,
              left: memberColumnWidth,
            }}
          >
            {/* 날짜 헤더 */}
            <DateAxis year={currentYear} cellWidth={cellWidth} />

            {/* 특이사항 행 — 프로젝트 선택 시에만 표시 */}
            {showGlobalRow && (() => {
              const globalH = getRowHeight(globalRowCount, zoomLevel);
              return (
                <div
                  className="relative border-b border-zinc-200 dark:border-zinc-800 bg-amber-50/40 dark:bg-amber-950/20"
                  style={{ height: globalH, width: totalWidth }}
                >
                  <GridRow year={currentYear} cellWidth={cellWidth} weekendColor={weekendColor} />
                  {globalSchedules.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      year={currentYear}
                      cellWidth={cellWidth}
                      rowHeight={globalH}
                      rowCount={globalRowCount}
                      isSelected={selectedScheduleId === s.id}
                      scrollLeft={viewportState.scrollLeft}
                      onSelect={handleScheduleSelect}
                      onEdit={openSchedulePage}
                    />
                  ))}
                </div>
              );
            })()}

            {/* 멤버별 행 */}
            {memberRowsHeight > 0 && (
              <div style={{ height: memberRowsHeight, position: "relative", width: totalWidth }}>
                {visibleMemberRows.map(({ item, top }) => (
                <div
                  key={item.member.memberId}
                  className="absolute left-0 border-b border-zinc-200 dark:border-zinc-800"
                  style={{ top, height: item.rowHeight, width: totalWidth }}
                >
                  {/* 행 배경 */}
                  <GridRow
                    year={currentYear}
                    cellWidth={cellWidth}
                    weekendColor={weekendColor}
                  />

                  {/* 일정 카드들 */}
                  {item.memberSchedules.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      year={currentYear}
                      cellWidth={cellWidth}
                      rowHeight={item.rowHeight}
                      rowCount={item.rowCount}
                      isSelected={selectedScheduleId === s.id || isCardSelected(s.id)}
                      isMultiSelected={isCardSelected(s.id)}
                      multiDragDeltaX={isMultiDragging && isCardSelected(s.id) ? multiDragDeltaX : null}
                      multiDragDeltaY={isMultiDragging && isCardSelected(s.id) ? multiDragDeltaY : null}
                      scrollLeft={viewportState.scrollLeft}
                      onMultiDragStart={handleMultiDragStart}
                      onMultiDragMove={handleMultiDragMove}
                      onMultiDragEnd={handleMultiDragComplete}
                      onSelect={handleScheduleSelect}
                      onEdit={openSchedulePage}
                    />
                  ))}
                </div>
                ))}
              </div>
            )}

            {/* 멤버가 없을 때 */}
            {visibleMembers.length === 0 && (
              <div className="flex items-center justify-center h-32 text-sm text-zinc-400">
                표시할 구성원이 없습니다.
              </div>
            )}

            {visibleMembers.length > 0 && (
              <div
                aria-hidden="true"
                style={{
                  height: TIMELINE_BOTTOM_SPACER_HEIGHT,
                  minHeight: 240,
                  width: totalWidth,
                  position: "relative",
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
        </div>
      </div>
      <ScheduleDeleteConfirmDialog
        target={deleteConfirmTarget}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
