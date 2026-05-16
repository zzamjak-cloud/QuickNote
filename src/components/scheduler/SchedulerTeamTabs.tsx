// 구성원 탭 — 통합 탭 + 헤더에서 선택한 조직/팀 소속 멤버 탭.
// Shift+클릭으로 다중 선택 가능.
import { Users } from "lucide-react";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { COLOR_PRESETS } from "../../lib/scheduler/colors";
import { useVisibleMembers } from "./hooks/useVisibleMembers";

// memberId 해시로 COLOR_PRESETS 인덱스를 결정하는 색상 함수
function colorForMember(memberId: string): string {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  }
  return COLOR_PRESETS[hash % COLOR_PRESETS.length] ?? COLOR_PRESETS[0] ?? "#3498DB";
}

export function SchedulerTeamTabs() {
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const selectMember = useSchedulerViewStore((s) => s.selectMember);
  const multiSelectedIds = useSchedulerViewStore((s) => s.multiSelectedIds);
  const setMultiSelected = useSchedulerViewStore((s) => s.setMultiSelected);
  const activeMembers = useVisibleMembers();

  // 단일 선택도 다중 선택도 없을 때 통합 탭 활성
  const isUnified = selectedMemberId === null && multiSelectedIds.length === 0;

  const handleMemberClick = (e: React.MouseEvent, memberId: string) => {
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

  return (
    <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 overflow-x-auto flex-shrink-0">
      <div className="flex gap-1 py-2">
        {/* 통합 탭 */}
        <button
          type="button"
          onClick={handleUnifiedClick}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors whitespace-nowrap ${
            isUnified
              ? "bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-t border-x border-zinc-200 dark:border-zinc-700"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <Users size={14} />
          통합
        </button>

        {/* 멤버 탭 */}
        {activeMembers.map((member) => {
          const isSelected =
            selectedMemberId === member.memberId ||
            multiSelectedIds.includes(member.memberId);
          const memberColor = colorForMember(member.memberId);
          return (
            <button
              key={member.memberId}
              type="button"
              onClick={(e) => handleMemberClick(e, member.memberId)}
              title="Shift+클릭으로 다중 선택"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors whitespace-nowrap ${
                isSelected
                  ? "bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-t border-x border-zinc-200 dark:border-zinc-700"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              style={
                isSelected
                  ? { borderBottomColor: memberColor, borderBottomWidth: "2px" }
                  : undefined
              }
            >
              {member.name}
            </button>
          );
        })}

        {/* 우측 빈 공간 */}
        <div className="flex-1" />
      </div>
    </div>
  );
}
