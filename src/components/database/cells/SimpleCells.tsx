// PhoneCell / UrlCell / EmailCell / FileCell — 단순 입력 셀.
// DatabaseCell.tsx 에서 분리 — 동작 변경 없음.

import { useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import type { CellValue, FileCellItem } from "../../../types/database";
import {
  deleteDatabaseFile,
  downloadBlob,
  getDatabaseFile,
} from "../../../lib/databaseFileStorage";
import { uploadFile } from "../../../lib/files/upload";
import { decodeFileRef, isFileRef } from "../../../lib/files/scheme";
import { imageUrlCache } from "../../../lib/images/registry";
import { formatPhone } from "./utils";

export function PhoneCell({
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

export function UrlCell({
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

/** 일반 텍스트 입력 — 값에 "@" 가 없으면 빨간 글자로 경고 표시 */
export function EmailCell({
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

export function FileCell({
  items,
  onChange,
}: {
  items: FileCellItem[];
  onChange: (v: CellValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const next = [...items];
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file);
        next.push({
          fileId: uploaded.ref,
          src: uploaded.ref,
          name: uploaded.name,
          mime: uploaded.mimeType,
          size: uploaded.size,
        });
      }
      onChange(next);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (item: FileCellItem) => {
    if (!fileCellRef(item)) {
      await deleteDatabaseFile(item.fileId);
    }
    onChange(items.filter((f) => f.fileId !== item.fileId));
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
                    await downloadFileCellItem(f);
                  }}
                >
                  <Download size={12} />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  title="첨부 삭제"
                  onClick={() => void removeFile(f)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 px-1 text-[10px] text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-200"
          >
            <Plus size={10} /> {uploading ? "업로드 중..." : "추가"}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 rounded border border-dashed border-zinc-300 px-2 py-1 text-[10px] text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus size={12} /> {uploading ? "업로드 중..." : "파일 추가"}
        </button>
      )}
      {error && <div className="px-1 text-[10px] text-red-500">{error}</div>}
    </div>
  );
}

function fileCellRef(item: FileCellItem): string | null {
  if (item.src) return item.src;
  return isFileRef(item.fileId) ? item.fileId : null;
}

async function downloadFileCellItem(item: FileCellItem): Promise<void> {
  const ref = fileCellRef(item);
  if (ref) {
    const fileId = decodeFileRef(ref);
    const href = fileId ? await imageUrlCache.get(fileId) : ref;
    const a = document.createElement("a");
    a.href = href;
    a.download = item.name;
    a.rel = "noopener noreferrer";
    a.click();
    return;
  }
  const blob = await getDatabaseFile(item.fileId);
  if (blob) downloadBlob(blob, item.name);
}
