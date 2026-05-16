// 일정 생성/수정 모달 — createPortal, 폼 필드, 색상 선택.
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMemberStore } from "../../store/memberStore";
import { useSchedulerStore, type Schedule, type CreateScheduleInput, type UpdateScheduleInput } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { pickTextColor } from "../../lib/scheduler/colors";
import { ColorPickerGrid } from "./ColorPickerGrid";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

// Date → "YYYY-MM-DD" 변환
function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "YYYY-MM-DD" → ISO 문자열
function fromDateInputValue(val: string, endOfDay = false): string {
  if (!val) return new Date().toISOString();
  const d = new Date(`${val}T00:00:00`);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

type Props = {
  /** 편집 모드: 기존 일정, 생성 모드: null */
  schedule: Schedule | null;
  /** 생성 시 기본 날짜 */
  defaultStartAt?: string;
  defaultEndAt?: string;
  /** 생성 시 기본 담당자 ID (null = 특이사항) */
  defaultAssigneeId?: string | null;
  /** 생성 시 기본 프로젝트 ID */
  defaultProjectId?: string | null;
  /** 생성 시 기본 행 인덱스 */
  defaultRowIndex?: number | null;
  workspaceId: string;
  onClose: () => void;
};

export function ScheduleEditPopup({
  schedule,
  defaultStartAt,
  defaultEndAt,
  defaultAssigneeId,
  defaultProjectId,
  defaultRowIndex,
  workspaceId,
  onClose,
}: Props) {
  const members = useMemberStore((s) => s.members);
  const activeMembers = members.filter((m) => m.status === "active");
  const defaultColor = useSchedulerViewStore((s) => s.defaultScheduleColor);
  const selectedScopeKey = useSchedulerViewStore((s) => s.selectedProjectId);

  const { createSchedule, updateSchedule, deleteSchedule } = useSchedulerStore();

  const isEdit = schedule !== null;
  const isSpecialCard = (schedule?.assigneeId ?? defaultAssigneeId ?? null) === null;
  const initColor = schedule?.color ?? defaultColor;

  const [title, setTitle] = useState(schedule?.title ?? "");
  const [comment, setComment] = useState(schedule?.comment ?? "");
  const [link, setLink] = useState(schedule?.link ?? "");
  // null이면 특이사항(담당자 없음) → 빈 문자열로 표현
  const [assigneeId, setAssigneeId] = useState(schedule?.assigneeId ?? defaultAssigneeId ?? "");
  const [color, setColor] = useState(initColor);
  const [startVal, setStartVal] = useState(
    schedule ? toDateInputValue(schedule.startAt) : (defaultStartAt ? toDateInputValue(defaultStartAt) : toDateInputValue(new Date().toISOString())),
  );
  const [endVal, setEndVal] = useState(
    schedule ? toDateInputValue(schedule.endAt) : (defaultEndAt ? toDateInputValue(defaultEndAt) : toDateInputValue(new Date().toISOString())),
  );
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (isEdit && schedule) {
        const input: UpdateScheduleInput = {
          id: schedule.id,
          workspaceId,
          title: title.trim(),
          comment: comment || null,
          link: link || null,
          assigneeId: assigneeId || null,
          color,
          textColor: pickTextColor(color),
          startAt: fromDateInputValue(startVal),
          endAt: fromDateInputValue(endVal, true),
        };
        await updateSchedule(input);
      } else {
        const input: CreateScheduleInput = {
          workspaceId,
          title: title.trim(),
          comment: comment || null,
          link: link || null,
          projectId: defaultProjectId ?? null,
          selectedScopeKey,
          assigneeId: assigneeId || null,
          color,
          textColor: pickTextColor(color),
          startAt: fromDateInputValue(startVal),
          endAt: fromDateInputValue(endVal, true),
          rowIndex: defaultRowIndex ?? 0,
        };
        await createSchedule(input);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }, [isEdit, schedule, title, comment, link, assigneeId, color, startVal, endVal, workspaceId, defaultProjectId, defaultRowIndex, selectedScopeKey, createSchedule, updateSchedule, onClose]);

  const handleDelete = useCallback(() => {
    if (!schedule) return;
    const scheduleId = schedule.id;
    setDeleteConfirmOpen(false);
    onClose();
    void deleteSchedule(scheduleId, workspaceId).catch((error) => {
      console.error(error);
      window.alert("일정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    });
  }, [schedule, workspaceId, deleteSchedule, onClose, setDeleteConfirmOpen]);

  return createPortal(
    <div
      className="fixed inset-0 z-[700] bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit ? "일정 편집" : "새 일정"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 제목 */}
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">제목</label>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            placeholder="일정 제목"
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 날짜 */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">시작일</label>
            <input
              type="date"
              value={startVal}
              onChange={(e) => setStartVal(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">종료일</label>
            <input
              type="date"
              value={endVal}
              onChange={(e) => setEndVal(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>

        {/* 담당자 */}
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">담당자</label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            disabled={isSpecialCard}
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">(특이사항 — 담당자 없음)</option>
            {activeMembers.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* 색상 선택 */}
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-2">색상</label>
          <ColorPickerGrid value={color} onChange={setColor} />
        </div>

        {/* 코멘트 */}
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">코멘트</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="메모를 입력하세요"
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
        </div>

        {/* 링크 */}
        <div className="mb-5">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">링크</label>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 justify-end">
          {isEdit && (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="px-3 py-1.5 text-sm rounded bg-red-500 hover:bg-red-600 text-white transition-colors mr-auto"
            >
              삭제
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !title.trim()}
            className="px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
      <SimpleConfirmDialog
        open={deleteConfirmOpen}
        title="일정 삭제"
        message={`"${schedule?.title || "제목 없음"}" 일정을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        danger
        zIndex={900}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </div>,
    document.body,
  );
}
