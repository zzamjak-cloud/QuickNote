// 연간 365일 메인 그리드 — DateAxis + 멤버별 행 + ScheduleCard.
// 인터랙션:
//   Ctrl/Alt+드래그 → 점선 마퀴로 신규 일정 생성
//   Shift+드래그    → 파란 실선 마퀴로 다중 카드 박스 선택
//   클릭           → 카드 단일 선택 / 빈 영역 클릭 → 선택 해제
//   더블클릭        → 편집 팝업
// 원본: TeamScheduler/src/components/schedule/ScheduleGrid.tsx 기반
import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { Plus, Minus, Star } from "lucide-react";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useMemberStore } from "../../store/memberStore";
import { useVisibleMembers } from "./hooks/useVisibleMembers";
import { useBoxSelection } from "./hooks/useBoxSelection";
import {
  daysInYear,
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
import { dateToX, widthForRange } from "../../lib/scheduler/gridUtils";
import { parseIsoDate } from "../../lib/scheduler/dateUtils";
import { DateAxis } from "./DateAxis";
import { GridRow } from "./GridRow";
import { ScheduleCard } from "./ScheduleCard";
import { ScheduleEditPopup } from "./ScheduleEditPopup";
import type { Schedule } from "../../store/schedulerStore";
import { ANNUAL_LEAVE_COLOR, pickTextColor } from "../../lib/scheduler/colors";
import { updateMemberApi } from "../../lib/sync/memberApi";

// ── 특이사항 이벤트 카드 ──────────────────────────────────────────────────────
type GlobalEventCardProps = {
  schedule: Schedule;
  year: number;
  cellWidth: number;
  rowHeight: number;
  rowCount: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
};

function GlobalEventCard({
  schedule,
  year,
  cellWidth,
  rowHeight,
  rowCount,
  isSelected,
  onSelect,
  onEdit,
}: GlobalEventCardProps) {
  const startDate = parseIsoDate(schedule.startAt);
  const endDate = parseIsoDate(schedule.endAt);
  const x = dateToX(year, startDate, cellWidth);
  const w = widthForRange(startDate, endDate, cellWidth);
  const rowIdx = schedule.rowIndex ?? 0;
  const slotHeight = rowCount > 0 ? rowHeight / rowCount : rowHeight;
  const y = rowIdx * slotHeight;
  const color = schedule.color ?? DEFAULT_GLOBAL_EVENT_COLOR;
  const textColor = schedule.textColor ?? "#ffffff";

  return (
    <div
      className={`absolute rounded-md select-none overflow-hidden border-2 cursor-pointer transition-shadow ${
        isSelected
          ? "ring-2 ring-amber-400 border-transparent shadow-md"
          : "border-transparent hover:shadow-sm"
      }`}
      style={{
        left: x + CARD_MARGIN,
        top: y + CARD_MARGIN,
        width: Math.max(0, w - CARD_MARGIN * 2),
        height: Math.max(0, slotHeight - CARD_MARGIN * 2),
        backgroundColor: color,
        color: textColor,
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(schedule.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit(schedule.id); }}
    >
      <div className="w-full h-full flex items-center px-1.5 gap-0.5 overflow-hidden">
        {/* 특이사항 카드 식별 아이콘 */}
        <Star size={10} className="flex-shrink-0 opacity-80" />
        <span className="text-xs font-medium leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
          {schedule.title || "제목 없음"}
        </span>
      </div>
    </div>
  );
}

// DateAxis 고정 높이: 월 라벨 24px + 일자/공휴일 행 28px = 52px
const DATE_AXIS_HEIGHT = 52;

// Ctrl/Alt+드래그 마퀴 시작 임계값 (px)
const MARQUEE_ACTIVATE_PX = 4;

// 특이사항 이벤트 기본 색상 (앰버)
const DEFAULT_GLOBAL_EVENT_COLOR = "#f59e0b";

// 마지막 구성원도 화면 중앙 근처까지 올려 볼 수 있도록 하단 스크롤 여백을 둔다.
const TIMELINE_BOTTOM_SPACER_HEIGHT = "50vh";

type Props = {
  workspaceId: string;
};

// 일 인덱스 → 날짜 ISO 문자열 변환
function dayIndexToDateIso(dayIdx: number, year: number, endOfDay = false): string {
  const base = startOfYear(year);
  const d = addDays(base, dayIdx);
  return endOfDay ? toIsoEndOfDay(d) : toIsoStartOfDay(d);
}

export function ScheduleGrid({ workspaceId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const suppressContainerClickRef = useRef(false);

  const schedules = useSchedulerStore((s) => s.schedules);
  const createSchedule = useSchedulerStore((s) => s.createSchedule);
  const updateSchedule = useSchedulerStore((s) => s.updateSchedule);
  const deleteSchedule = useSchedulerStore((s) => s.deleteSchedule);
  const members = useMemberStore((s) => s.members);
  const {
    zoomLevel,
    columnWidthScale,
    currentYear,
    selectedMemberId,
    selectedProjectId,
    selectedScheduleId,
    multiSelectedIds,
    weekendColor,
    selectSchedule,
  } = useSchedulerViewStore();

  // 마운트 시 1회 + 연도 변경 시에만 오늘 스크롤을 실행하기 위한 가드
  const didInitialScrollRef = useRef(false);
  const prevYearRef = useRef(currentYear);

  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  // ── Ctrl/Alt+드래그 신규 일정 생성 상태 ────────────────────────────────────
  // dragMode: "create" = Ctrl/Alt 드래그, "box" = Shift 드래그 (useBoxSelection이 담당)
  const [dragState, setDragState] = useState<{
    kind: "schedule" | "leave";
    startDayIdx: number;
    rowTop: number;   // 컨테이너 내 행 상단 y
    rowHeight: number;
    rowIndex: number;
    assigneeId: string | null;
    currentDayIdx: number;
    active: boolean;  // 임계값 초과 여부
  } | null>(null);
  // useEffect 클로저 문제 방지용 ref — mouseup 핸들러에서 최신 상태 직접 참조
  const dragRef = useRef<typeof dragState>(null);

  // 드래그 완료 후 팝업에 전달할 기본값 (assigneeId=null 이면 특이사항)
  const [newScheduleDefaults, setNewScheduleDefaults] = useState<{
    startAt: string;
    endAt: string;
    assigneeId: string | null;
    rowIndex: number;
  } | null>(null);

  // 멤버별 사용자 지정 행 수 (최소 1, 최대 10)
  const [memberRowCounts, setMemberRowCounts] = useState<Record<string, number>>({});

  // 특이사항 행 수 (별도 관리)
  const [globalRowCount, setGlobalRowCount] = useState(1);

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

  // 일정 필터링 + 멤버별 그룹화
  // assigneeId === null 이고 projectId === selectedProjectId → 특이사항(글로벌 이벤트)
  const { schedulesByMember, globalSchedules } = useMemo(() => {
    const map: Record<string, Schedule[]> = {};
    const globals: Schedule[] = [];
    let filtered = schedules;
    if (selectedProjectFilterId) {
      filtered = filtered.filter((s) => s.projectId === selectedProjectFilterId);
    }
    for (const s of filtered) {
      if (s.assigneeId == null) {
        globals.push(s);
      } else {
        const aid = s.assigneeId!;
        if (!map[aid]) map[aid] = [];
        map[aid].push(s);
      }
    }
    return { schedulesByMember: map, globalSchedules: globals };
  }, [schedules, selectedProjectFilterId]);

  // 멤버 실제 행 수 계산
  const rowCountForMember = useCallback(
    (memberId: string, memberSchedules: Schedule[]) => {
      const cardRows = computeRowCount(memberSchedules);
      const userRows = memberRowCounts[memberId] ?? 1;
      return Math.max(cardRows, userRows);
    },
    [memberRowCounts],
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

  // 오늘로 스크롤
  const scrollToToday = useCallback(() => {
    if (!containerRef.current || todayIdx === null) return;
    const containerWidth = containerRef.current.clientWidth;
    const x = todayIdx * cellWidth;
    containerRef.current.scrollLeft = Math.max(0, x - containerWidth / 2);
  }, [todayIdx, cellWidth]);

  const syncLeftColumnScroll = useCallback(() => {
    if (!containerRef.current || !leftColRef.current) return;
    leftColRef.current.scrollTop = containerRef.current.scrollTop;
  }, []);

  const handleLeftColumnWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    container.scrollTop += e.deltaY;
    syncLeftColumnScroll();
  }, [syncLeftColumnScroll]);

  useEffect(() => {
    window.addEventListener("lc-scheduler:scroll-today", scrollToToday);
    return () => {
      window.removeEventListener("lc-scheduler:scroll-today", scrollToToday);
    };
  }, [scrollToToday]);

  // 마운트 시 1회 오늘로 자동 스크롤.
  // 연도 변경 시에도 재실행하되, 줌 변경(cellWidth만 변경)은 재실행하지 않음.
  useEffect(() => {
    const yearChanged = prevYearRef.current !== currentYear;
    if (!didInitialScrollRef.current || yearChanged) {
      const id = setTimeout(() => {
        scrollToToday();
        didInitialScrollRef.current = true;
        prevYearRef.current = currentYear;
      }, 0);
      return () => clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, cellWidth]);

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

      let accum = DATE_AXIS_HEIGHT;
      // 특이사항 행이 표시 중이면 먼저 확인
      if (showGlobalRow) {
        const globalH = getRowHeight(globalRowCount, zoomLevel);
        if (y < accum + globalH) {
          const slotH = globalRowCount > 0 ? globalH / globalRowCount : globalH;
          const rowIndex = Math.max(0, Math.min(globalRowCount - 1, Math.floor((y - accum) / slotH)));
          return { top: accum + rowIndex * slotH, height: slotH, rowIndex, assigneeId: null };
        }
        accum += globalH;
      }
      for (const member of visibleMembers) {
        const memberSchedules = schedulesByMember[member.memberId] ?? [];
        const rowCount = rowCountForMember(member.memberId, memberSchedules);
        const rowH = getRowHeight(rowCount, zoomLevel);
        if (y < accum + rowH) {
          const slotH = rowCount > 0 ? rowH / rowCount : rowH;
          const rowIndex = Math.max(0, Math.min(rowCount - 1, Math.floor((y - accum) / slotH)));
          return {
            top: accum + rowIndex * slotH,
            height: slotH,
            rowIndex,
            assigneeId: member.memberId,
          };
        }
        accum += rowH;
      }
      return null;
    },
    [
      totalWidth,
      visibleMembers,
      schedulesByMember,
      rowCountForMember,
      zoomLevel,
      showGlobalRow,
      globalRowCount,
    ],
  );

  // 마우스 다운: 수정키에 따라 모드 분기
  //   Ctrl/Alt/Meta → 일정 생성 드래그
  //   없음          → 빈 영역 박스 선택 드래그
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 이미 존재하는 카드 위에서 시작하면 무시 (react-rnd 카드가 처리)
      if ((e.target as HTMLElement).closest(".schedule-card")) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;

      const container = containerRef.current;
      if (!container) return;

      if (isCtrl || isAlt) {
        // Ctrl/Alt+드래그: 신규 일정 생성 마퀴
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft;
        const y = e.clientY - rect.top + container.scrollTop;
        const row = pointToScheduleRow(x, y);
        if (!row) return;
        if (isAlt && row.assigneeId == null) return;

        e.preventDefault();
        const dayIdx = xToDayIndex(Math.max(0, Math.min(totalWidth - 1, x)));
        const newState: NonNullable<typeof dragState> = {
          kind: isAlt ? "leave" : "schedule",
          startDayIdx: dayIdx,
          rowTop: row.top,
          rowHeight: row.height,
          rowIndex: row.rowIndex,
          assigneeId: row.assigneeId,
          currentDayIdx: dayIdx,
          active: false,
        };
        dragRef.current = newState;
        setDragState(newState);
        // 박스 선택 초기화
        clearSelection();
      } else {
        // 빈 영역 드래그: 박스 선택 마퀴
        e.preventDefault();
        handleBoxSelectStart(e, container);
      }
    },
    [clearSelection, handleBoxSelectStart, pointToScheduleRow, totalWidth, xToDayIndex],
  );

  // macOS 의 Ctrl+클릭은 contextmenu 를 발생시키므로 차단해 드래그 마퀴 유지
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || dragRef.current) {
      e.preventDefault();
    }
  }, []);

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

  // window 레벨 mousemove/mouseup — Ctrl/Alt+드래그 일정 생성 처리
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const rawX = e.clientX - rect.left + container.scrollLeft;
      const dayIdx = xToDayIndex(Math.max(0, Math.min(totalWidth - 1, rawX)));
      const dx = Math.abs(dayIdx - dragRef.current.startDayIdx) * cellWidth;
      const next = {
        ...dragRef.current,
        currentDayIdx: dayIdx,
        active: dragRef.current.active || dx > MARQUEE_ACTIVATE_PX,
      };
      dragRef.current = next;
      setDragState(next);
    };

    const onMouseUp = () => {
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.active) {
        const startDayIdx = Math.min(cur.startDayIdx, cur.currentDayIdx);
        const endDayIdx = Math.max(cur.startDayIdx, cur.currentDayIdx);
        const startAt = dayIndexToDateIso(startDayIdx, currentYear, false);
        const endAt = dayIndexToDateIso(endDayIdx, currentYear, true);
        if (cur.kind === "leave" && cur.assigneeId) {
          void createSchedule({
            workspaceId,
            title: "연차",
            projectId: selectedProjectFilterId ?? null,
            assigneeId: cur.assigneeId,
            color: ANNUAL_LEAVE_COLOR,
            textColor: pickTextColor(ANNUAL_LEAVE_COLOR),
            startAt,
            endAt,
            rowIndex: cur.rowIndex,
          }).catch((error) => {
            console.error(error);
            window.alert("연차 카드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          });
        } else {
          setNewScheduleDefaults({
            startAt,
            endAt,
            assigneeId: cur.assigneeId,
            rowIndex: cur.rowIndex,
          });
        }
      }
      dragRef.current = null;
      setDragState(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
   
  }, [cellWidth, createSchedule, currentYear, selectedProjectFilterId, totalWidth, workspaceId, xToDayIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (newScheduleDefaults || editingSchedule) return;

      if (e.key === "Escape" && selectedCardIds.size > 0) {
        clearSelection();
        return;
      }

      if (!selectedScheduleId) return;
      const selected = schedules.find((schedule) => schedule.id === selectedScheduleId);
      if (!selected) return;

      if (e.key === "Enter") {
        e.preventDefault();
        setEditingSchedule(selected);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const ok = window.confirm(`"${selected.title || "제목 없음"}" 일정을 삭제하시겠습니까?`);
        if (!ok) return;
        void deleteSchedule(selected.id, workspaceId).catch((error) => {
          console.error(error);
          window.alert("일정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        });
        selectSchedule(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearSelection,
    deleteSchedule,
    editingSchedule,
    newScheduleDefaults,
    schedules,
    selectedCardIds.size,
    selectSchedule,
    selectedScheduleId,
    workspaceId,
  ]);

  // Ctrl/Alt+드래그 마퀴 overlay 위치 — 컨텐츠 좌표 그대로(내부 div 의 position:relative 기준)
  // 활성화 임계값 통과 전에도 즉시 작은 사각형이 보이도록 active 검사 제거
  const createMarqueeStyle = useMemo(() => {
    if (!dragState) return null;
    const startDayIdx = Math.min(dragState.startDayIdx, dragState.currentDayIdx);
    const endDayIdx = Math.max(dragState.startDayIdx, dragState.currentDayIdx);
    return {
      kind: dragState.kind,
      left: startDayIdx * cellWidth,
      top: dragState.rowTop,
      width: Math.max(cellWidth, (endDayIdx - startDayIdx + 1) * cellWidth),
      height: dragState.rowHeight,
    };
  }, [dragState, cellWidth]);

  // Shift+드래그 박스 선택 마퀴 overlay 위치 계산 (스크롤 보정)
  // Shift+드래그 박스 선택 마퀴 — 컨텐츠 좌표 그대로 사용
  const boxMarqueeStyle = useMemo(() => {
    if (!isBoxSelecting || !selectionRect) return null;
    return {
      left: Math.min(selectionRect.startX, selectionRect.endX),
      top: Math.min(selectionRect.startY, selectionRect.endY),
      width: Math.abs(selectionRect.endX - selectionRect.startX),
      height: Math.abs(selectionRect.endY - selectionRect.startY),
    };
  }, [isBoxSelecting, selectionRect]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 본문: 좌측 고정 멤버 컬럼 + 우측 스크롤 타임라인 */}
      <div className="flex-1 overflow-hidden relative flex">
        {/* 좌측 고정 멤버 이름 컬럼 */}
        <div
          ref={leftColRef}
          className="w-[120px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 z-30 relative overflow-hidden"
          onWheel={handleLeftColumnWheel}
        >
          {/* DateAxis 와 같은 높이의 빈 헤더 공간 */}
          <div
            className="border-b border-zinc-200 dark:border-zinc-800"
            style={{ height: DATE_AXIS_HEIGHT }}
          />
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
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
          {visibleMembers.map((member) => {
            const memberSchedules = schedulesByMember[member.memberId] ?? [];
            const rowCount = rowCountForMember(member.memberId, memberSchedules);
            const rowH = getRowHeight(rowCount, zoomLevel);
            const cardRows = computeRowCount(memberSchedules);
            const canRemove = (memberRowCounts[member.memberId] ?? 1) > Math.max(1, cardRows);

            return (
              <div
                key={member.memberId}
                className="group relative border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center px-2"
                style={{ height: rowH }}
              >
                {/* 멤버 이름 — 셀 중앙 정렬 */}
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-full text-center">
                  {member.name}
                </span>

                {/* +/- 버튼 — 절대위치 우측 하단, 호버 시만 표시 */}
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleAddRow(member.memberId, memberSchedules)}
                    title="행 추가"
                    disabled={(memberRowCounts[member.memberId] ?? 1) >= 10}
                    className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                  >
                    <Plus size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(member.memberId, memberSchedules)}
                    title="행 제거"
                    disabled={!canRemove}
                    className="w-4 h-4 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shadow-sm disabled:opacity-40"
                  >
                    <Minus size={10} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* 멤버가 없을 때 좌측 공간 */}
          {visibleMembers.length === 0 && (
            <div style={{ height: 128 }} />
          )}

          {visibleMembers.length > 0 && (
            <div
              aria-hidden="true"
              style={{
                height: TIMELINE_BOTTOM_SPACER_HEIGHT,
                minHeight: 240,
              }}
            />
          )}
        </div>

        {/* 우측 스크롤 타임라인 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto relative"
          onClick={handleContainerClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
          onScroll={syncLeftColumnScroll}
          style={{ userSelect: (dragState || isBoxSelecting) ? "none" : undefined }}
        >
          <div style={{ width: totalWidth, minWidth: totalWidth, position: "relative" }}>
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
                    <GlobalEventCard
                      key={s.id}
                      schedule={s}
                      year={currentYear}
                      cellWidth={cellWidth}
                      rowHeight={globalH}
                      rowCount={globalRowCount}
                      isSelected={selectedScheduleId === s.id}
                      onSelect={(id) => { selectSchedule(id); clearSelection(); }}
                      onEdit={(id) => {
                        const found = schedules.find((x) => x.id === id) ?? null;
                        setEditingSchedule(found);
                      }}
                    />
                  ))}
                </div>
              );
            })()}

            {/* 멤버별 행 */}
            {visibleMembers.map((member) => {
              const memberSchedules = schedulesByMember[member.memberId] ?? [];
              const rowCount = rowCountForMember(member.memberId, memberSchedules);
              const rowH = getRowHeight(rowCount, zoomLevel);

              return (
                <div
                  key={member.memberId}
                  className="relative border-b border-zinc-200 dark:border-zinc-800"
                  style={{ height: rowH, width: totalWidth }}
                >
                  {/* 행 배경 */}
                  <GridRow
                    year={currentYear}
                    cellWidth={cellWidth}
                    weekendColor={weekendColor}
                  />

                  {/* 일정 카드들 */}
                  {memberSchedules.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      year={currentYear}
                      cellWidth={cellWidth}
                      rowHeight={rowH}
                      rowCount={rowCount}
                      isSelected={selectedScheduleId === s.id || isCardSelected(s.id)}
                      isMultiSelected={isCardSelected(s.id)}
                      multiDragDeltaX={isMultiDragging && isCardSelected(s.id) ? multiDragDeltaX : null}
                      multiDragDeltaY={isMultiDragging && isCardSelected(s.id) ? multiDragDeltaY : null}
                      onMultiDragStart={() => handleMultiDragStart(s.id)}
                      onMultiDragMove={handleMultiDragMove}
                      onMultiDragEnd={handleMultiDragComplete}
                      onSelect={handleScheduleSelect}
                      onEdit={(id) => {
                        const found = schedules.find((x) => x.id === id) ?? null;
                        setEditingSchedule(found);
                      }}
                    />
                  ))}
                </div>
              );
            })}

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
                }}
              />
            )}

            {/* Ctrl/Alt+드래그 생성 마퀴 — 내부 컨텐츠 좌표 기준 */}
            {createMarqueeStyle && (
              <div
                className="absolute border-2 border-dashed pointer-events-none rounded-sm"
                style={{
                  left: createMarqueeStyle.left,
                  top: createMarqueeStyle.top,
                  width: createMarqueeStyle.width,
                  height: createMarqueeStyle.height,
                  borderColor:
                    createMarqueeStyle.kind === "leave" ? "#ef4444" : "#3b82f6",
                  backgroundColor:
                    createMarqueeStyle.kind === "leave"
                      ? "rgb(252 165 165 / 0.25)"
                      : "rgb(147 197 253 / 0.25)",
                  zIndex: 100,
                }}
              />
            )}

            {/* Shift+드래그 박스 선택 마퀴 — 컨텐츠 좌표 기준 */}
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
        </div>
      </div>

      {/* 일정 편집 팝업 */}
      {editingSchedule && (
        <ScheduleEditPopup
          schedule={editingSchedule}
          workspaceId={workspaceId}
          onClose={() => setEditingSchedule(null)}
        />
      )}

      {/* Ctrl/Alt+드래그로 생성하는 새 일정 팝업 */}
      {newScheduleDefaults && (
        <ScheduleEditPopup
          schedule={null}
          workspaceId={workspaceId}
          defaultStartAt={newScheduleDefaults.startAt}
          defaultEndAt={newScheduleDefaults.endAt}
          defaultAssigneeId={newScheduleDefaults.assigneeId}
          defaultRowIndex={newScheduleDefaults.rowIndex}
          defaultProjectId={selectedProjectFilterId}
          onClose={() => setNewScheduleDefaults(null)}
        />
      )}
    </div>
  );
}
