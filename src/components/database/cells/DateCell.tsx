// 날짜 셀 — 캘린더 팝오버로 범위 선택.
// DatabaseCell.tsx 에서 분리 — 동작 변경 없음.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CellValue, ColumnDef } from "../../../types/database";
import { useAnchoredPopover } from "../../../hooks/useAnchoredPopover";
import {
  formatDate,
  sameDay,
  stripTime,
  toDate,
  toIsoEnd,
  toIsoStart,
} from "./utils";

export function DateCell({
  value,
  onChange,
}: {
  column: ColumnDef;
  value: { start?: string; end?: string };
  onChange: (v: CellValue) => void;
}) {
  const pop = useAnchoredPopover(248);
  const startDate = value.start ? toDate(value.start) : null;
  const endDate = value.end ? toDate(value.end) : null;
  const [viewMonth, setViewMonth] = useState<Date>(
    () => startDate ?? new Date(),
  );

  const onPickDay = (day: Date) => {
    const s = startDate;
    const e = endDate;
    if (!s || (s && e)) {
      // 새 범위 시작
      onChange({ start: toIsoStart(day), end: undefined });
      return;
    }
    // s 있고 e 없음: 두 번째 클릭 → 범위 확정 (작은 쪽이 시작)
    if (sameDay(day, s)) {
      onChange({ start: toIsoStart(day), end: undefined });
      return;
    }
    if (day < s) {
      onChange({ start: toIsoStart(day), end: toIsoEnd(s) });
    } else {
      onChange({ start: toIsoStart(s), end: toIsoEnd(day) });
    }
  };

  const clearRange = () => {
    onChange({ start: undefined, end: undefined });
    pop.close();
  };

  const label = (() => {
    if (!startDate) return "";
    const s = formatDate(startDate);
    if (!endDate || sameDay(startDate, endDate)) return s;
    return `${s} → ${formatDate(endDate)}`;
  })();

  const isEmpty = !startDate;

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(248)}
        title={label || "날짜 선택"}
        className={[
          "flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-sm",
          isEmpty
            ? "text-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
        ].join(" ")}
      >
        {isEmpty ? " " : <span>{label}</span>}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 248,
            }}
            className="z-[700] rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <CalendarMonth
              viewMonth={viewMonth}
              setViewMonth={setViewMonth}
              start={startDate}
              end={endDate}
              onPickDay={onPickDay}
            />
            <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1 dark:border-zinc-800">
              <button
                type="button"
                onClick={clearRange}
                className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                지우기
              </button>
              <span className="text-[10px] text-zinc-400">
                {!startDate
                  ? "시작일을 클릭"
                  : !endDate
                    ? "종료일을 클릭 (또는 같은 날짜 다시 클릭하여 단일)"
                    : "선택 완료"}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function CalendarMonth({
  viewMonth,
  setViewMonth,
  start,
  end,
  onPickDay,
}: {
  viewMonth: Date;
  setViewMonth: (d: Date) => void;
  start: Date | null;
  end: Date | null;
  onPickDay: (d: Date) => void;
}) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  // 6주 × 7일 그리드 — 앞뒤 빈 칸은 회색 표시
  const cells: { date: Date; current: boolean }[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), current: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), current: true });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1]!.date;
    const next = new Date(last);
    next.setDate(last.getDate() + 1);
    cells.push({ date: next, current: next.getMonth() === month });
  }

  const inRange = (d: Date) =>
    start && end && d >= stripTime(start) && d <= stripTime(end);

  const isStart = (d: Date) => start && sameDay(d, start);
  const isEnd = (d: Date) => end && sameDay(d, end);

  const today = new Date();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState(() =>
    `${year}-${String(month + 1).padStart(2, "0")}`,
  );

  useEffect(() => {
    if (!jumpOpen) {
      setJumpValue(`${year}-${String(month + 1).padStart(2, "0")}`);
    }
  }, [jumpOpen, month, year]);

  const commitJump = () => {
    const m = /^(\d{1,4})[-./년\s]+(\d{1,2})/.exec(jumpValue.trim());
    if (!m) {
      setJumpOpen(false);
      return;
    }
    const y = Math.max(1, Math.min(9999, Number(m[1])));
    const mo = Math.max(1, Math.min(12, Number(m[2])));
    setViewMonth(new Date(y, mo - 1, 1));
    setJumpOpen(false);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={12} />
        </button>
        {jumpOpen ? (
          <input
            autoFocus
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onBlur={commitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitJump();
              if (e.key === "Escape") setJumpOpen(false);
            }}
            className="w-24 rounded border border-zinc-300 px-1 py-0.5 text-center text-xs outline-none dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="YYYY-MM"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setJumpOpen(true)}
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="더블클릭하여 년/월 직접 입력"
          >
            {year}년 {month + 1}월
          </button>
        )}
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-zinc-400">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="py-0.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((c, i) => {
          const inR = inRange(c.date);
          const s = isStart(c.date);
          const e = isEnd(c.date);
          const t = sameDay(c.date, today);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPickDay(c.date)}
              className={[
                "h-6 text-center text-[11px] transition-colors",
                !c.current ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-200",
                s || e
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : inR
                    ? "bg-blue-100 dark:bg-blue-950"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                s ? "rounded-l" : "",
                e ? "rounded-r" : "",
                !s && !e && !inR ? "rounded" : "",
                t && !s && !e ? "ring-1 ring-blue-300 ring-inset" : "",
              ].join(" ")}
            >
              {c.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
