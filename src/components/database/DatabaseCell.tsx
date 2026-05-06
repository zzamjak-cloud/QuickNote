import { useEffect, useRef, useState } from "react";
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
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setVal(e.target.value)}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
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
          className="w-full rounded border border-transparent px-1 py-0.5 text-xs outline-none focus:border-zinc-300 dark:focus:border-zinc-600"
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
        className="flex min-h-[20px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {selected.map((o) => (
          <span
            key={o.id}
            className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-900 dark:bg-blue-950 dark:text-blue-100"
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
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-[10px] text-zinc-500">
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
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left",
                      on
                        ? "bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded border text-[8px]",
                        on
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-zinc-300 dark:border-zinc-600",
                      ].join(" ")}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="truncate">{o.label}</span>
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
          "flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-left text-[11px]",
          isEmpty
            ? "text-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
        ].join(" ")}
      >
        {isEmpty ? " " : <span>{label}</span>}
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
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}. ${mm}. ${dd}`;
}

function PersonCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [items, setItems] = useState<Array<{ memberId: string; name: string; jobRole: string }>>([]);

  const query = (() => {
    const idx = value.lastIndexOf("@");
    if (idx < 0) return "";
    return value.slice(idx + 1).trim();
  })();

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
  }, [value, open]);

  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    void (async () => {
      const found = await searchMembersForMentionApi(query, 8);
      if (!cancelled) setItems(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  const applyMention = (name: string) => {
    const idx = value.lastIndexOf("@");
    if (idx < 0) {
      onChange(name);
      setOpen(false);
      return;
    }
    const next = `${value.slice(0, idx)}@${name}`;
    onChange(next.trim());
    setOpen(false);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          setOpen(next.includes("@"));
        }}
        onFocus={() => setOpen(value.includes("@"))}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        placeholder="담당자 @이름"
        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-zinc-300 focus:border-zinc-300 dark:focus:border-zinc-600 dark:placeholder:text-zinc-600"
      />
      {open && coords
        ? createPortal(
            <div
              style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
              className="z-50 max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            >
              {items.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-zinc-500">멤버 검색 결과가 없습니다.</div>
              ) : (
                items.map((m) => (
                  <button
                    key={m.memberId}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyMention(m.name)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="truncate">@{m.name}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-zinc-500">{m.jobRole}</span>
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
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
        className="flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {current ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: current.color ?? "#6b7280" }}
          >
            {current.label}
          </span>
        ) : (
          <span className="text-[10px] text-zinc-400">옵션 없음</span>
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
            className="z-50 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-[10px] text-zinc-500">옵션이 없습니다</div>
            ) : (
              opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    pop.close();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: o.color ?? "#6b7280" }}
                  />
                  <span className="truncate">{o.label}</span>
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
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-zinc-300 focus:border-zinc-300 dark:focus:border-zinc-600 dark:placeholder:text-zinc-600"
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
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

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
