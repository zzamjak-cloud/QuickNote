// 구성원 탭 — 통합 탭 + 헤더에서 선택한 조직/팀 소속 멤버 탭.
// Shift+클릭으로 다중 선택 가능.
import type { MouseEvent as ReactMouseEvent } from "react";
import { Users } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { LC_SCHEDULER_DATABASE_ID } from "../../lib/scheduler/database";
import { COLOR_PRESETS } from "../../lib/scheduler/colors";
import { useVisibleMembers } from "./hooks/useVisibleMembers";
import type { Member } from "../../store/memberStore";

// memberId 해시로 COLOR_PRESETS 인덱스를 결정하는 색상 함수
function colorForMember(memberId: string): string {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  }
  return COLOR_PRESETS[hash % COLOR_PRESETS.length] ?? COLOR_PRESETS[0] ?? "#3498DB";
}

function mergeVisibleMemberOrder(
  existingOrder: readonly string[],
  visibleIds: readonly string[],
  reorderedVisibleIds: readonly string[],
): string[] {
  const visibleSet = new Set(visibleIds);
  const queue = [...reorderedVisibleIds];
  const merged: string[] = [];

  for (const id of existingOrder) {
    if (visibleSet.has(id)) {
      const nextVisibleId = queue.shift();
      if (nextVisibleId) merged.push(nextVisibleId);
    } else {
      merged.push(id);
    }
  }

  for (const id of queue) merged.push(id);
  for (const id of reorderedVisibleIds) {
    if (!merged.includes(id)) merged.push(id);
  }

  return merged;
}

const restrictMemberTabDragToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

type SortableMemberTabProps = {
  member: Member;
  isSelected: boolean;
  onClick: (event: ReactMouseEvent, memberId: string) => void;
};

function SortableMemberTab({ member, isSelected, onClick }: SortableMemberTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: member.memberId });
  const memberColor = colorForMember(member.memberId);

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      onClick={(event) => onClick(event, member.memberId)}
      title="Shift+클릭으로 다중 선택, 드래그로 순서 변경"
      className={`flex cursor-grab items-center gap-2 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors whitespace-nowrap border-x border-t border-b-2 active:cursor-grabbing ${
        isSelected
          ? "bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700"
          : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-x-transparent border-t-transparent border-b-transparent"
      } ${isDragging ? "opacity-70 shadow-sm" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isSelected ? { borderBottomColor: memberColor } : undefined),
      }}
    >
      {member.name}
    </button>
  );
}

export function SchedulerTeamTabs() {
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const selectMember = useSchedulerViewStore((s) => s.selectMember);
  const multiSelectedIds = useSchedulerViewStore((s) => s.multiSelectedIds);
  const setMultiSelected = useSchedulerViewStore((s) => s.setMultiSelected);
  const activeMembers = useVisibleMembers();
  // 구성원 탭 순서는 작업 DB panelState 에 저장 → 워크스페이스 전 사용자에게 공유 동기화.
  const schedulerMemberOrder = useDatabaseStore(
    (s) => s.databases[LC_SCHEDULER_DATABASE_ID]?.panelState?.schedulerMemberOrder,
  );
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // 단일 선택도 다중 선택도 없을 때 통합 탭 활성
  const isUnified = selectedMemberId === null && multiSelectedIds.length === 0;

  const handleMemberClick = (e: ReactMouseEvent, memberId: string) => {
    if (e.shiftKey) {
      // Shift+클릭: 다중 선택 토글
      const next = multiSelectedIds.includes(memberId)
        ? multiSelectedIds.filter((id) => id !== memberId)
        : [...multiSelectedIds, memberId];
      setMultiSelected(next);
      // 단일 선택 해제 (통합 탭 로직을 다중 선택이 담당)
      selectMember(null);
    } else {
      // 일반 클릭: 단일 선택
      setMultiSelected([]);
      selectMember(memberId);
    }
  };

  const handleUnifiedClick = () => {
    setMultiSelected([]);
    selectMember(null);
  };

  const memberIds = activeMembers.map((member) => member.memberId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = memberIds.indexOf(String(active.id));
    const newIndex = memberIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedVisibleIds = arrayMove(memberIds, oldIndex, newIndex);
    patchDatabasePanelState(LC_SCHEDULER_DATABASE_ID, {
      schedulerMemberOrder: mergeVisibleMemberOrder(
        schedulerMemberOrder ?? [],
        memberIds,
        reorderedVisibleIds,
      ),
      schedulerMemberOrderUpdatedAt: Date.now(),
    });
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 overflow-x-auto flex-shrink-0">
      <div className="flex gap-1 py-2">
        {/* 통합 탭 */}
        <button
          type="button"
          onClick={handleUnifiedClick}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors whitespace-nowrap border-x border-t border-b-2 ${
            isUnified
              ? "bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700 border-b-zinc-300 dark:border-b-zinc-500"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-x-transparent border-t-transparent border-b-transparent"
          }`}
        >
          <Users size={14} />
          통합
        </button>

        {/* 멤버 탭 */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictMemberTabDragToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={memberIds} strategy={horizontalListSortingStrategy}>
            {activeMembers.map((member) => (
              <SortableMemberTab
                key={member.memberId}
                member={member}
                isSelected={
                  selectedMemberId === member.memberId ||
                  multiSelectedIds.includes(member.memberId)
                }
                onClick={handleMemberClick}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* 우측 빈 공간 */}
        <div className="flex-1" />
      </div>
    </div>
  );
}
