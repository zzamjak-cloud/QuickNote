// LC 스케줄러 주간 그리드 — 7일 컬럼 × 구성원 행.
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSchedulerStore, type Schedule } from "../../store/schedulerStore";
import { useMemberStore } from "../../store/memberStore";

type WeekGridProps = {
  workspaceId: string;
};

const DAY_MS = 86_400_000;
const COLORS = ["#4f8ef7", "#f76b4f", "#4fc47f", "#f7c24f", "#a04ff7", "#f74fa0", "#4ff7e8"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=일요일
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(d, diff));
}

function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDow(d: Date): string {
  const labels = ["일", "월", "화", "수", "목", "금", "토"];
  return labels[d.getDay()] ?? "";
}

export function WeekGrid({ workspaceId }: WeekGridProps) {
  const [monday, setMonday] = useState(() => getMondayOfWeek(new Date()));
  const { schedules, loading, fetchSchedules, createSchedule, updateSchedule, deleteSchedule } =
    useSchedulerStore();
  const members = useMemberStore((s) => s.members);

  // 이번 주 7일
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = addDays(monday, 6);

  useEffect(() => {
    void fetchSchedules(
      workspaceId,
      monday.toISOString(),
      addDays(sunday, 1).toISOString(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, monday.toISOString()]);

  const prevWeek = () => setMonday((m) => addDays(m, -7));
  const nextWeek = () => setMonday((m) => addDays(m, 7));
  const toThisWeek = () => setMonday(getMondayOfWeek(new Date()));

  const today = startOfDay(new Date());
  const isToday = (d: Date) => d.getTime() === today.getTime();

  // 활성 구성원만 표시 (status 값이 두 가지 형태가 섞여 있을 수 있어 모두 허용)
  const activeMembers = members.filter(
    (m) => (m.status as string) === "ACTIVE" || m.status === "active",
  );

  // 특정 멤버의 특정 날짜에 해당하는 일정 필터
  const getDaySchedules = (memberId: string, day: Date) => {
    const start = day.getTime();
    const end = start + DAY_MS;
    return schedules.filter((s) => {
      if (s.assigneeId !== memberId) return false;
      const st = Date.parse(s.startAt);
      const et = Date.parse(s.endAt);
      return st < end && et > start;
    });
  };

  const [creating, setCreating] = useState<{ memberId: string; day: Date } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const handleCellClick = (memberId: string, day: Date) => {
    setCreating({ memberId, day });
    setNewTitle("");
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!creating || !newTitle.trim()) {
      setCreating(null);
      return;
    }
    const startAt = creating.day.toISOString();
    const endAt = addDays(creating.day, 1).toISOString();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    await createSchedule({
      workspaceId,
      title: newTitle.trim(),
      startAt,
      endAt,
      assigneeId: creating.memberId,
      color,
    });
    setCreating(null);
  };

  const handleEditSave = async () => {
    if (!editingSchedule) return;
    await updateSchedule({
      id: editingSchedule.id,
      workspaceId,
      title: editingSchedule.title,
      startAt: editingSchedule.startAt,
      endAt: editingSchedule.endAt,
    });
    setEditingId(null);
    setEditingSchedule(null);
  };

  const handleDelete = async (id: string) => {
    await deleteSchedule(id, workspaceId);
    setEditingId(null);
    setEditingSchedule(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 주 네비게이션 헤더 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <button
          type="button"
          onClick={prevWeek}
          className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={toThisWeek}
          className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          오늘
        </button>
        <button
          type="button"
          onClick={nextWeek}
          className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronRight size={18} />
        </button>
        <span className="ml-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {monday.getFullYear()}년 {monday.getMonth() + 1}월
        </span>
        {loading && <span className="ml-2 text-xs text-zinc-400">불러오는 중…</span>}
      </div>

      {/* 그리드 본체 */}
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
            <tr>
              <th className="w-32 border-b border-r border-zinc-200 px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                구성원
              </th>
              {weekDays.map((d) => (
                <th
                  key={d.toISOString()}
                  className={[
                    "min-w-[120px] border-b border-r border-zinc-200 px-2 py-2 text-center text-xs font-medium dark:border-zinc-700",
                    isToday(d)
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                      : d.getDay() === 0 || d.getDay() === 6
                        ? "bg-zinc-50 text-zinc-400 dark:bg-zinc-800/40"
                        : "text-zinc-500 dark:text-zinc-400",
                  ].join(" ")}
                >
                  <div>{fmtDow(d)}</div>
                  <div className={isToday(d) ? "font-bold" : ""}>{fmtMD(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeMembers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-zinc-400">
                  구성원 정보를 불러오는 중…
                </td>
              </tr>
            ) : (
              activeMembers.map((member) => (
                <tr key={member.memberId} className="group">
                  <td className="border-b border-r border-zinc-200 px-3 py-2 align-top dark:border-zinc-700">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {member.name}
                    </div>
                    {member.jobRole && (
                      <div className="text-[10px] text-zinc-400">{member.jobRole}</div>
                    )}
                  </td>
                  {weekDays.map((day) => {
                    const dayScheds = getDaySchedules(member.memberId, day);
                    return (
                      <td
                        key={day.toISOString()}
                        className={[
                          "relative min-h-[60px] cursor-pointer border-b border-r border-zinc-200 px-1 py-1 align-top dark:border-zinc-700",
                          day.getDay() === 0 || day.getDay() === 6
                            ? "bg-zinc-50 dark:bg-zinc-800/20"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30",
                        ].join(" ")}
                        onClick={() => handleCellClick(member.memberId, day)}
                      >
                        <div className="flex min-h-[52px] flex-col gap-0.5">
                          {dayScheds.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(s.id);
                                setEditingSchedule({ ...s });
                                setCreating(null);
                              }}
                              style={{ background: s.color ?? "#4f8ef7" }}
                              className="w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white hover:opacity-90"
                            >
                              {s.title}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 새 일정 생성 팝업 */}
      {creating && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30"
          onClick={() => setCreating(null)}
        >
          <div
            className="w-72 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium text-zinc-500">
              {fmtMD(creating.day)} 새 일정
            </p>
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") setCreating(null);
              }}
              placeholder="일정 제목"
              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(null)}
                className="rounded px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일정 편집 팝업 */}
      {editingId && editingSchedule && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30"
          onClick={() => {
            setEditingId(null);
            setEditingSchedule(null);
          }}
        >
          <div
            className="w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-500">일정 편집</p>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setEditingSchedule(null);
                }}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X size={14} />
              </button>
            </div>
            <input
              type="text"
              value={editingSchedule.title}
              onChange={(e) =>
                setEditingSchedule((s) => (s ? { ...s, title: e.target.value } : s))
              }
              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] text-zinc-400">시작</label>
                <input
                  type="date"
                  value={editingSchedule.startAt.slice(0, 10)}
                  onChange={(e) =>
                    setEditingSchedule((s) =>
                      s ? { ...s, startAt: new Date(e.target.value).toISOString() } : s,
                    )
                  }
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10px] text-zinc-400">종료</label>
                <input
                  type="date"
                  value={editingSchedule.endAt.slice(0, 10)}
                  onChange={(e) =>
                    setEditingSchedule((s) =>
                      s ? { ...s, endAt: new Date(e.target.value).toISOString() } : s,
                    )
                  }
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-between">
              <button
                type="button"
                onClick={() => void handleDelete(editingSchedule.id)}
                className="rounded px-3 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                삭제
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setEditingSchedule(null);
                  }}
                  className="rounded px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleEditSave()}
                  className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
