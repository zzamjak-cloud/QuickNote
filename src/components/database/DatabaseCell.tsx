import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import type { CellValue, ColumnDef, FileCellItem } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import {
  putDatabaseFile,
  downloadBlob,
  getDatabaseFile,
  deleteDatabaseFile,
} from "../../lib/databaseFileStorage";
import { newId } from "../../lib/id";
import { searchMembersForMentionApi } from "../../lib/sync/memberApi";
import {
  formatDate,
  formatPhone,
  normalizePersonValue,
  optionStyle,
  personChipColor,
  sameDay,
  stripTime,
  toDate,
  toIsoEnd,
  toIsoStart,
} from "./cells/utils";

type Props = {
  databaseId: string;
  rowId: string;
  column: ColumnDef;
  value: CellValue;
};

function TitleCell({
  databaseId,
  rowId,
  column,
  value,
}: {
  databaseId: string;
  rowId: string;
  column: ColumnDef;
  value: string;
}) {
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const [draft, setDraft] = useState(value);

  // 외부에서 값이 변경될 때만 동기화 (편집 중 루프 방지)
  const committedRef = useRef(true);
  useEffect(() => {
    if (committedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const t = draft.trim();
    const final = t || value; // 빈 값이면 편집 시작 전 원래 값으로 복원
    committedRef.current = true;
    if (final !== value) updateCell(databaseId, rowId, column.id, final);
    else setDraft(final);
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        committedRef.current = false;
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          committedRef.current = true;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="제목 없음"
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
    />
  );
}

// 500+ 셀이 각자 store 구독 시 한 셀 변경으로 전체 셀 shouldUpdate 트리거 방지
// props 얕은 비교: column 객체·value 모두 불변 패턴으로 전달되므로 memo 효과 있음
export const DatabaseCell = memo(function DatabaseCell({ databaseId, rowId, column, value }: Props) {
  const updateCell = useDatabaseStore((s) => s.updateCell);

  const setVal = (v: CellValue) => {
    updateCell(databaseId, rowId, column.id, v);
  };

  switch (column.type) {
    case "title":
      return (
        <TitleCell
          databaseId={databaseId}
          rowId={rowId}
          column={column}
          value={typeof value === "string" ? value : ""}
        />
      );
    case "text":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setVal(e.target.value)}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
        />
      );
    case "phone":
      return (
        <PhoneCell value={typeof value === "string" ? value : ""} onChange={setVal} />
      );
    case "email":
      return (
        <EmailCell value={typeof value === "string" ? value : ""} onChange={setVal} />
      );
    case "number":
      return (
        <input
          type="number"
          value={
            typeof value === "number"
              ? value
              : typeof value === "string"
                ? value
                : ""
          }
          onChange={(e) => {
            const v = e.target.value;
            setVal(v === "" ? null : Number(v));
          }}
          className="w-full rounded border border-transparent px-1 py-0.5 text-sm outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setVal(e.target.checked)}
          className="h-4 w-4"
        />
      );
    case "url":
      return (
        <UrlCell value={typeof value === "string" ? value : ""} onChange={setVal} />
      );
    case "select":
      return (
        <SelectCell
          column={column}
          value={typeof value === "string" ? value : ""}
          onChange={setVal}
        />
      );
    case "status":
      return (
        <StatusCell
          column={column}
          value={typeof value === "string" ? value : ""}
          onChange={setVal}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectCell
          column={column}
          value={
            Array.isArray(value) &&
            value.every((x) => typeof x === "string")
              ? value
              : []
          }
          onChange={setVal}
        />
      );
    case "date":
      return (
        <DateCell
          column={column}
          value={
            typeof value === "object" && value !== null && !Array.isArray(value)
              ? (value as { start?: string; end?: string })
              : {}
          }
          onChange={setVal}
        />
      );
    case "person":
      return (
        <PersonCell
          value={
            Array.isArray(value)
              ? (value as string[])
              : typeof value === "string"
                ? value
                : ""
          }
          onChange={setVal}
        />
      );
    case "file":
      return (
        <FileCell
          items={Array.isArray(value) ? (value as FileCellItem[]) : []}
          onChange={setVal}
        />
      );
    default:
      return (
        <span className="text-xs text-zinc-400">{String(value ?? "")}</span>
      );
  }
});

function SelectCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const current = opts.find((o) => o.id === value) ?? null;
  const pop = useAnchoredPopover(180);

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(180)}
        title="옵션 선택"
        className="flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {current ? (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
            style={optionStyle(current.color)}
          >
            {current.label}
          </span>
        ) : null}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 180,
            }}
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                pop.close();
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              — 선택 해제
            </button>
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-xs text-zinc-500">옵션이 없습니다</div>
            ) : (
              opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    pop.close();
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                    style={optionStyle(o.color)}
                  >
                    {o.label}
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function MultiSelectCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string[];
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const pop = useAnchoredPopover(200);

  const toggle = (id: string) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set]);
  };

  const selected = opts.filter((o) => value.includes(o.id));

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(200)}
        title="옵션 선택"
        className="flex min-h-[20px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {selected.map((o) => (
          <span
            key={o.id}
            className="rounded px-1.5 py-0.5 text-xs text-white"
            style={optionStyle(o.color)}
          >
            {o.label}
          </span>
        ))}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            style={{ position: "fixed", top: pop.coords.top, left: pop.coords.left, width: 200 }}
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-xs text-zinc-500">
                옵션이 없습니다. 컬럼 메뉴에서 추가하세요.
              </div>
            ) : (
              opts.map((o) => {
                const on = value.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={[
                      "block w-full rounded px-2 py-1 text-left",
                      on
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white",
                        on ? "" : "opacity-70",
                      ].join(" ")}
                      style={optionStyle(o.color)}
                    >
                      {o.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function DateCell({
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
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 248,
            }}
            className="z-50 rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
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

// ---- 날짜 헬퍼들 ----
// 셀 공통 유틸(date/person/phone 헬퍼)은 ./cells/utils 로 분리됨.

/** 사람(person) 셀 — 칩 배열 형태로 멤버를 관리.
 *  - @ 또는 일반 텍스트 입력 시 팝업 열림
 *  - 팝업 열림: ArrowUp/Down 팝업 항목 이동, Enter 확정
 *  - 팝업 닫힘: ArrowLeft/Right 칩 단위 이동 (chipFocusIdx)
 *  - 칩 선택 상태: Backspace/Delete → 해당 칩 삭제
 *  - 빈 input에서 Backspace → 마지막 칩 삭제
 */
function PersonCell({
  value,
  onChange,
}: {
  value: string | string[];
  onChange: (v: CellValue) => void;
}) {
  // string[]으로 정규화 — 콤마 구분 기존 데이터 포함
  const chips = normalizePersonValue(value);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [items, setItems] = useState<Array<{ memberId: string; name: string; jobRole: string }>>([]);
  // 팝업 항목 커서
  const [activeIdx, setActiveIdx] = useState(0);
  // 칩 선택 커서: -1 = input 포커스, 0..chips.length-1 = 해당 칩 선택
  const [chipFocusIdx, setChipFocusIdx] = useState(-1);

  // 팝업 위치 갱신
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
  }, [draft, open]);

  // 멤버 검색
  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    void (async () => {
      const query = draft.startsWith("@") ? draft.slice(1) : draft;
      const found = await searchMembersForMentionApi(query, 8);
      if (!cancelled) {
        setItems(found);
        setActiveIdx(0);
      }
    })();
    return () => { cancelled = true; };
  }, [open, draft]);

  const addChip = (name: string) => {
    if (!chips.includes(name)) {
      onChange([...chips, name]);
    }
    setDraft("");
    setOpen(false);
    setChipFocusIdx(-1);
    inputRef.current?.focus();
  };

  const removeChipAt = (idx: number) => {
    const next = chips.filter((_, i) => i !== idx);
    onChange(next);
    // 삭제 후 인접 칩 또는 input으로 포커스 이동
    if (next.length === 0) {
      setChipFocusIdx(-1);
      inputRef.current?.focus();
    } else {
      setChipFocusIdx(Math.min(idx, next.length - 1));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 팝업 열림: Up/Down/Enter는 팝업 항목 이동
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (items[activeIdx]) addChip(items[activeIdx].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setDraft("");
        return;
      }
    }

    // 팝업 닫힘: 칩 이동 로직
    if (!open) {
      if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0 && draft === "") {
        e.preventDefault();
        // 칩이 있으면 마지막 칩으로 이동
        if (chips.length > 0) setChipFocusIdx(chips.length - 1);
        return;
      }
      if (e.key === "ArrowRight" && draft === "") {
        e.preventDefault();
        // chipFocusIdx가 -1이면 이미 input — 무시
        return;
      }
    }

    // Backspace: 텍스트 없을 때 마지막 칩 삭제
    if (e.key === "Backspace" && draft === "" && !open) {
      e.preventDefault();
      if (chips.length > 0) removeChipAt(chips.length - 1);
    }
  };

  // 칩 선택 상태에서 키보드 처리
  const handleChipKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, idx: number) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setChipFocusIdx(idx > 0 ? idx - 1 : 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (idx < chips.length - 1) {
        setChipFocusIdx(idx + 1);
      } else {
        // 마지막 칩 → input으로 복귀
        setChipFocusIdx(-1);
        inputRef.current?.focus();
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeChipAt(idx);
    } else if (e.key !== "Tab" && e.key !== "Shift") {
      // 다른 키 → 칩 선택 해제 후 input 포커스
      setChipFocusIdx(-1);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {/* group: hover/focus-within 시 border 표시 */}
      <div
        ref={wrapperRef}
        className="group flex min-h-[28px] w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded border border-transparent px-1 py-0.5 hover:border-zinc-300 focus-within:border-zinc-300 dark:hover:border-zinc-600 dark:focus-within:border-zinc-600"
      >
        {/* 칩 목록 — select 옵션 스타일과 동일, 선택 시 ring 하이라이트, X 버튼 hover 시 표시 */}
        {chips.map((name, idx) => (
          <span
            key={`${name}-${idx}`}
            tabIndex={0}
            role="button"
            aria-label={`${name} 키보드로 이동`}
            onKeyDown={(e) => handleChipKeyDown(e, idx)}
            onFocus={() => setChipFocusIdx(idx)}
            onBlur={() => {
              window.setTimeout(() => {
                if (document.activeElement === inputRef.current) return;
                setChipFocusIdx(-1);
              }, 50);
            }}
            className={[
              "group/chip relative inline-flex cursor-default items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-white outline-none",
              chipFocusIdx === idx ? "ring-2 ring-white ring-offset-1" : "",
            ].join(" ")}
            style={{ backgroundColor: personChipColor(name) }}
          >
            {name}
            {/* 칩 X 버튼 — hover 시 표시 */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${name} 제거`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeChipAt(idx);
              }}
              className="ml-0.5 hidden rounded-full p-px leading-none hover:bg-white/30 group-hover/chip:flex"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </span>
        ))}
        {/* @ 입력 필드 — 비어있을 때는 너비 0으로 숨김, hover/focus 시 노출 */}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            setChipFocusIdx(-1);
            setOpen(v.length > 0);
          }}
          onFocus={() => {
            setChipFocusIdx(-1);
            if (draft.length > 0) setOpen(true);
          }}
          onBlur={() => { window.setTimeout(() => setOpen(false), 150); }}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? "@ 이름 입력" : ""}
          className={[
            "bg-transparent text-xs outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600",
            // 빈 상태: 평소 w-0 숨김, hover/focus 시 노출
            draft === ""
              ? "w-0 min-w-0 opacity-0 group-hover:w-auto group-hover:min-w-[60px] group-hover:opacity-100 focus:w-auto focus:min-w-[60px] focus:opacity-100"
              : "min-w-[60px] flex-1",
          ].join(" ")}
        />
      </div>
      {open && coords && createPortal(
        <div
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          className="z-50 max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">멤버 검색 결과가 없습니다.</div>
          ) : (
            items.map((m, idx) => (
              <button
                key={m.memberId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addChip(m.name)}
                className={[
                  "flex w-full items-center justify-between rounded px-2 py-1 text-left",
                  idx === activeIdx
                    ? "bg-zinc-100 dark:bg-zinc-800"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                <span className="truncate">{m.name}</span>
                <span className="ml-2 shrink-0 text-xs text-zinc-500">{m.jobRole}</span>
              </button>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function StatusCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const pop = useAnchoredPopover(180);

  const current = opts.find((o) => o.id === value) ?? opts[0];

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(180)}
        title="상태 변경"
        className="flex min-h-[20px] w-full items-center rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {current ? (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: current.color ?? "#6b7280" }}
          >
            {current.label}
          </span>
        ) : (
          <span className="text-xs text-zinc-400">옵션 없음</span>
        )}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 180,
            }}
            className="z-50 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-xs text-zinc-500">옵션이 없습니다</div>
            ) : (
              opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    pop.close();
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: o.color ?? "#6b7280" }}
                  >
                    {o.label}
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function PhoneCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: CellValue) => void;
}) {
  return (
    <input
      type="tel"
      value={formatPhone(value)}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      placeholder="010-0000-0000"
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-zinc-300 focus:border-zinc-300 dark:focus:border-zinc-600 dark:placeholder:text-zinc-600"
    />
  );
}

function UrlCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const isUrl = /^https?:\/\//i.test(value);
  return (
    <div className="group/url relative flex w-full items-center">
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://..."
        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 pr-8 text-xs outline-none placeholder:text-zinc-300 focus:border-zinc-300 dark:focus:border-zinc-600 dark:placeholder:text-zinc-600"
      />
      {isUrl && (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded bg-white/95 px-1 py-0.5 text-[10px] text-blue-600 underline opacity-0 transition-opacity group-hover/url:opacity-100 dark:bg-zinc-950/95 dark:text-blue-400"
          title={value}
        >
          열기
        </a>
      )}
    </div>
  );
}

/** 숫자만 추출해 3-4-4 자리로 하이픈 삽입 (최대 11자리). */
/** 일반 텍스트 입력 — 값에 "@" 가 없으면 빨간 글자로 경고 표시 */
function EmailCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const isInvalid = value.length > 0 && !value.includes("@");
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="email@example.com"
      className={[
        "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-zinc-300 focus:border-zinc-300 dark:focus:border-zinc-600 dark:placeholder:text-zinc-600",
        isInvalid ? "text-red-500 dark:text-red-400" : "",
      ].join(" ")}
    />
  );
}

function FileCell({
  items,
  onChange,
}: {
  items: FileCellItem[];
  onChange: (v: CellValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...items];
    for (const file of Array.from(files)) {
      const fileId = newId();
      await putDatabaseFile(fileId, file);
      next.push({
        fileId,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = async (fileId: string) => {
    await deleteDatabaseFile(fileId);
    onChange(items.filter((f) => f.fileId !== fileId));
  };

  return (
    <div className="max-w-[220px] space-y-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void addFiles(e.target.files)}
      />
      {items.length > 0 ? (
        <>
          <ul className="space-y-0.5">
            {items.map((f) => (
              <li
                key={f.fileId}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                  title="다운로드"
                  onClick={async () => {
                    const blob = await getDatabaseFile(f.fileId);
                    if (blob) downloadBlob(blob, f.name);
                  }}
                >
                  <Download size={12} />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  title="첨부 삭제"
                  onClick={() => void removeFile(f.fileId)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 px-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Plus size={10} /> 추가
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 rounded border border-dashed border-zinc-300 px-2 py-1 text-[10px] text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus size={12} /> 파일 추가
        </button>
      )}
    </div>
  );
}
