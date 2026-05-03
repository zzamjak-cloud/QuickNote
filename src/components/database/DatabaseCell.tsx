import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import type { CellValue, ColumnDef, FileCellItem } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  useContactsStore,
  searchContacts,
} from "../../store/contactsStore";
import {
  putDatabaseFile,
  downloadBlob,
  getDatabaseFile,
  deleteDatabaseFile,
} from "../../lib/databaseFileStorage";
import { newId } from "../../lib/id";

type Props = {
  databaseId: string;
  rowId: string;
  column: ColumnDef;
  value: CellValue;
};

export function DatabaseCell({ databaseId, rowId, column, value }: Props) {
  const updateCell = useDatabaseStore((s) => s.updateCell);

  const setVal = (v: CellValue) => {
    updateCell(databaseId, rowId, column.id, v);
  };

  switch (column.type) {
    case "title":
    case "text":
    case "phone":
    case "email":
      return (
        <input
          type={column.type === "email" ? "email" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setVal(e.target.value)}
          className="w-full min-w-[120px] rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
        />
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
          className="w-full min-w-[72px] rounded border border-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
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
        <div className="flex items-center gap-1">
          <input
            type="url"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setVal(e.target.value)}
            className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
          />
          {typeof value === "string" && value.startsWith("http") && (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[10px] text-blue-600 underline dark:text-blue-400"
            >
              열기
            </a>
          )}
        </div>
      );
    case "select":
    case "status":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setVal(e.target.value || null)}
          className="max-w-[160px] rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="">—</option>
          {(column.config?.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
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
        <PersonCell value={typeof value === "string" ? value : ""} onChange={setVal} />
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
  const toggle = (id: string) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set]);
  };
  return (
    <div className="flex max-w-[220px] flex-wrap gap-1">
      {opts.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={[
              "rounded px-1.5 py-0.5 text-[10px]",
              on
                ? "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const startDate = value.start ? toDate(value.start) : null;
  const endDate = value.end ? toDate(value.end) : null;
  const [viewMonth, setViewMonth] = useState<Date>(
    () => startDate ?? new Date(),
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const togglePopover = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 248;
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  };

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
    setOpen(false);
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
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title={label || "날짜 선택"}
        className={[
          "flex items-center gap-1 rounded px-1 py-0.5 text-[11px]",
          isEmpty
            ? "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
        ].join(" ")}
      >
        <Calendar size={12} />
        {!isEmpty && <span>{label}</span>}
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 248 }}
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
        <span className="text-xs font-medium">
          {year}년 {month + 1}월
        </span>
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
function toDate(iso: string): Date {
  return new Date(iso);
}
function toIsoStart(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00`;
}
function toIsoEnd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T23:59:59`;
}
function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function PersonCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const contacts = useContactsStore((s) => s.contacts);
  const addContact = useContactsStore((s) => s.addContact);
  const [q, setQ] = useState("");
  const filtered = searchContacts(contacts, q);
  return (
    <div className="relative min-w-[140px]">
      <div className="flex gap-1">
        <input
          type="text"
          placeholder="이메일 검색…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-200 px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
        />
        <button
          type="button"
          title="연락처 등록"
          className="shrink-0 rounded border border-zinc-200 px-1 text-[10px] dark:border-zinc-600"
          onClick={() => {
            const email = window.prompt("이메일");
            const displayName = window.prompt("표시 이름");
            if (email?.trim() && displayName?.trim()) {
              addContact(email.trim(), displayName.trim());
            }
          }}
        >
          +
        </button>
      </div>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value || null);
          setQ("");
        }}
        className="mt-0.5 w-full rounded border border-zinc-200 bg-white text-xs dark:border-zinc-600 dark:bg-zinc-900"
      >
        <option value="">—</option>
        {(q ? filtered : contacts).map((c) => (
          <option key={c.id} value={c.email}>
            {c.displayName} ({c.email})
          </option>
        ))}
      </select>
    </div>
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
