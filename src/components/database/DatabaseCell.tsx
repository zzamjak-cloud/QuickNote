import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CellValue, ColumnDef, FileCellItem } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  parseJsonValueInput,
  stringifyJsonValue,
  summarizeJsonValue,
} from "../../lib/database/jsonCell";
import { DateCell } from "./cells/DateCell";
import { PersonCell } from "./cells/PersonCell";
import { MultiSelectCell, SelectCell, StatusCell } from "./cells/OptionCells";
import { EmailCell, FileCell, PhoneCell, UrlCell } from "./cells/SimpleCells";
import { DbLinkCell } from "./cells/DbLinkCell";
import { PageLinkCell } from "./cells/PageLinkCell";
import { ProgressCell } from "./cells/ProgressCell";
import { ItemFetchCell } from "./cells/ItemFetchCell";
import { usePageStore } from "../../store/pageStore";
import {
  isCellValueDerived,
  resolveDerivedCellValue,
  shouldUseManualCellValueForAutomation,
} from "../../lib/database/columnSource";
import { resolvePageLinkMirrorValue } from "../../lib/database/pageLinkMirror";

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

function JsonCell({ value, onChange }: { value: CellValue; onChange: (v: CellValue) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => stringifyJsonValue(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setDraft(stringifyJsonValue(value));
  }, [open, value]);

  const commit = () => {
    const parsed = parseJsonValueInput(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    onChange(parsed.value);
    setError(null);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(stringifyJsonValue(value));
          setError(null);
          setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title="JSON 편집"
      >
        <span className="truncate text-zinc-600 dark:text-zinc-300">{summarizeJsonValue(value)}</span>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
          JSON
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[760] flex items-center justify-center bg-black/25 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">JSON 값</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  닫기
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                spellCheck={false}
                className="h-72 w-full resize-none rounded border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs text-zinc-900 outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder={`{\n  "key": "value"\n}`}
              />
              {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft("");
                    setError(null);
                  }}
                  className="rounded px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  비우기
                </button>
                <button
                  type="button"
                  onClick={commit}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  적용
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// 500+ 셀이 각자 store 구독 시 한 셀 변경으로 전체 셀 shouldUpdate 트리거 방지
// props 얕은 비교: column 객체·value 모두 불변 패턴으로 전달되므로 memo 효과 있음
export const DatabaseCell = memo(function DatabaseCell({ databaseId, rowId, column, value }: Props) {
  const updateCell = useDatabaseStore((s) => s.updateCell);
  // 자동 derive(sourceFromDb)·pageLink 미러 컬럼만 pages/databases 전량을 횡단 조회해야 한다.
  // 그 외 컬럼은 derived/mirror 가 항상 no-op 이므로 store 구독 자체를 생략해, 무관한 행/DB 변경에
  // 의한 리렌더를 차단한다(값은 전적으로 value prop 에서 옴 — 동작 동일).
  const needsCrossStore =
    Boolean(column.config?.sourceFromDb) || column.type === "pageLink";
  // 조건 없이 호출하되, 불필요 시 null 을 반환해 해당 store 변화로 리렌더되지 않게 한다.
  const databases = useDatabaseStore((s) => (needsCrossStore ? s.databases : null));
  const pages = usePageStore((s) => (needsCrossStore ? s.pages : null));

  let effectiveValue: CellValue = value;
  let pageLinkMirror: string[] | undefined;
  let isDerived = false;
  let usesManualAutomationValue = false;
  if (needsCrossStore && pages && databases) {
    const rowCells = pages[rowId]?.dbCells;
    const derived = resolveDerivedCellValue(column, rowCells, pages, {
      currentRowPageId: rowId,
      databases,
    });
    pageLinkMirror = resolvePageLinkMirrorValue({
      databases,
      pages,
      currentDatabaseId: databaseId,
      rowId,
      column,
    });
    isDerived = isCellValueDerived(column);
    usesManualAutomationValue = shouldUseManualCellValueForAutomation(column, derived);
    effectiveValue = isDerived && !usesManualAutomationValue ? ((derived as CellValue) ?? null) : value;
  }

  const setVal = (v: CellValue) => {
    if (isDerived && !usesManualAutomationValue) return; // 미러 컬럼은 직접 편집 차단
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
    case "json":
      return <JsonCell value={value} onChange={setVal} />;
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
          value={typeof effectiveValue === "string" ? effectiveValue : ""}
          onChange={setVal}
        />
      );
    case "status":
      return (
        <StatusCell
          column={column}
          value={typeof effectiveValue === "string" ? effectiveValue : ""}
          onChange={setVal}
        />
      );
    case "multiSelect":
      return (
        <MultiSelectCell
          column={column}
          value={
            Array.isArray(effectiveValue) &&
            effectiveValue.every((x) => typeof x === "string")
              ? (effectiveValue as string[])
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
    case "dbLink":
      return (
        <DbLinkCell
          value={typeof value === "string" ? value : null}
          onChange={setVal}
        />
      );
    case "pageLink":
      return (
        <PageLinkCell
          databaseId={databaseId}
          rowId={rowId}
          columnId={column.id}
          value={
            pageLinkMirror ??
            (Array.isArray(effectiveValue) && effectiveValue.every((x) => typeof x === "string")
              ? (effectiveValue as string[])
              : [])
          }
          readOnly={pageLinkMirror !== undefined || (isDerived && !usesManualAutomationValue)}
        />
      );
    case "progress":
      return (
        <ProgressCell
          column={column}
          rowId={rowId}
          value={typeof value === "number" ? value : null}
          onChange={setVal}
        />
      );
    case "itemFetch":
      return (
        <ItemFetchCell
          databaseId={databaseId}
          rowId={rowId}
          column={column}
        />
      );
    default:
      return (
        <span className="text-xs text-zinc-400">{String(value ?? "")}</span>
      );
  }
});
