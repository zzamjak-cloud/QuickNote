import { useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
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
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: { start?: string; end?: string };
  onChange: (v: CellValue) => void;
}) {
  const showEnd = column.config?.dateShowEnd !== false;
  return (
    <div className="flex flex-col gap-0.5 text-[10px]">
      <input
        type="date"
        value={value.start?.slice(0, 10) ?? ""}
        onChange={(e) =>
          onChange({
            ...value,
            start: e.target.value ? `${e.target.value}T00:00:00` : undefined,
          })
        }
        className="rounded border border-zinc-200 bg-white px-1 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {showEnd && (
        <input
          type="date"
          value={value.end?.slice(0, 10) ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              end: e.target.value ? `${e.target.value}T23:59:59` : undefined,
            })
          }
          className="rounded border border-zinc-200 bg-white px-1 dark:border-zinc-600 dark:bg-zinc-900"
        />
      )}
    </div>
  );
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
