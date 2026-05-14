import { memo, useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import type { CellValue, ColumnDef, FileCellItem } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  putDatabaseFile,
  downloadBlob,
  getDatabaseFile,
  deleteDatabaseFile,
} from "../../lib/databaseFileStorage";
import { newId } from "../../lib/id";
import { formatPhone } from "./cells/utils";
import { DateCell } from "./cells/DateCell";
import { PersonCell } from "./cells/PersonCell";
import { MultiSelectCell, SelectCell, StatusCell } from "./cells/OptionCells";

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
