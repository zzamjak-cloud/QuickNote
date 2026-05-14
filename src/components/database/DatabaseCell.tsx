import { memo, useEffect, useRef, useState } from "react";
import type { CellValue, ColumnDef, FileCellItem } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { DateCell } from "./cells/DateCell";
import { PersonCell } from "./cells/PersonCell";
import { MultiSelectCell, SelectCell, StatusCell } from "./cells/OptionCells";
import { EmailCell, FileCell, PhoneCell, UrlCell } from "./cells/SimpleCells";

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

