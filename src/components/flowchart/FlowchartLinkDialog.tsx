// 플로우차트 도형 링크 편집 다이얼로그 — 외부 웹 URL 또는 내부 페이지 멘션 연결.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, FileText, X } from "lucide-react";
import {
  loadMergedMentionItems,
  type MentionListItem,
} from "../../lib/comments/mentionItems";
import { stripPagePrefix } from "../../lib/tiptapExtensions/mentionKind";
import type { FlowchartNodeLink } from "../../types/flowchart";

type Props = {
  open: boolean;
  initialLink?: FlowchartNodeLink;
  onSave: (link: FlowchartNodeLink | null) => void;
  onClose: () => void;
};

type Mode = "url" | "page";

// 스킴 없는 입력은 https:// 를 붙여 저장한다.
function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

export function FlowchartLinkDialog({
  open,
  initialLink,
  onSave,
  onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [pageQuery, setPageQuery] = useState("");
  const [pages, setPages] = useState<MentionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initialLink?.type === "page") {
      setMode("page");
      setUrl("");
    } else {
      setMode("url");
      setUrl(initialLink?.type === "url" ? initialLink.url : "");
    }
    setPageQuery("");
    setPages([]);
    const t = window.setTimeout(() => urlInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, initialLink]);

  // 페이지 검색 (디바운스)
  useEffect(() => {
    if (!open || mode !== "page") return;
    const q = pageQuery.trim();
    if (!q) {
      setPages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      void loadMergedMentionItems(q, 24, { includeRemoteMembers: false }).then(
        (rows) => {
          if (cancelled) return;
          setPages(rows.filter((r) => r.mentionKind === "page"));
          setLoading(false);
        },
      );
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, mode, pageQuery]);

  const canSaveUrl = useMemo(() => url.trim().length > 0, [url]);

  if (!open) return null;

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
      active
        ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    }`;

  return createPortal(
    <div
      className="fixed inset-0 z-[510] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="도형 링크 편집"
        className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            링크 연결
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            className={tabClass(mode === "url")}
            onClick={() => setMode("url")}
          >
            <Globe className="h-4 w-4" /> 웹 링크
          </button>
          <button
            type="button"
            className={tabClass(mode === "page")}
            onClick={() => setMode("page")}
          >
            <FileText className="h-4 w-4" /> 페이지 연결
          </button>
        </div>

        {mode === "url" ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const normalized = normalizeUrl(url);
              if (normalized) onSave({ type: "url", url: normalized });
            }}
          >
            <input
              ref={urlInputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-sky-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <div className="flex justify-end gap-2">
              {initialLink && (
                <button
                  type="button"
                  onClick={() => onSave(null)}
                  className="rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  링크 제거
                </button>
              )}
              <button
                type="submit"
                disabled={!canSaveUrl}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                저장
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={pageQuery}
              onChange={(e) => setPageQuery(e.target.value)}
              placeholder="페이지 검색"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-sky-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <div className="h-64 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-700">
              {!pageQuery.trim() ? (
                <div className="px-3 py-6 text-center text-xs text-zinc-400">
                  연결할 페이지를 검색하세요.
                </div>
              ) : loading && pages.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-zinc-500">
                  불러오는 중…
                </div>
              ) : pages.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-zinc-500">
                  일치하는 페이지가 없습니다.
                </div>
              ) : (
                pages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onSave({
                        type: "page",
                        // 멘션 아이템 id 는 "p:" 접두가 붙어 있어 실제 페이지 id 로 푼다.
                        pageId: stripPagePrefix(item.id),
                        label: item.label,
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {item.label}
                    </span>
                    {item.subtitle && (
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {item.subtitle}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
            {initialLink && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onSave(null)}
                  className="rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  링크 제거
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
