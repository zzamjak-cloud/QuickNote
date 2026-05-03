import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";
import { Editor } from "../editor/Editor";

const PEEK_WIDTH_KEY = "quicknote.peekWidth.v1";
const DEFAULT_PEEK_WIDTH = 720;
const MIN_PEEK_WIDTH = 380;
const MAX_PEEK_WIDTH_RATIO = 0.9; // 화면 폭의 90%까지 허용

function loadPeekWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PEEK_WIDTH;
  const raw = localStorage.getItem(PEEK_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < MIN_PEEK_WIDTH) return DEFAULT_PEEK_WIDTH;
  return n;
}

export function DatabaseRowPeek() {
  const peekPageId = useUiStore((s) => s.peekPageId);
  const closePeek = useUiStore((s) => s.closePeek);
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const renamePage = usePageStore((s) => s.renamePage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const [width, setWidth] = useState<number>(() => loadPeekWidth());

  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, peekPageId]);

  useEffect(() => {
    if (!peekPageId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekPageId, closePeek]);

  // 너비 드래그 — 좌측 모서리를 잡고 좌우로 이동.
  const dragRef = useRef<{ originX: number; originWidth: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { originX: e.clientX, originWidth: width };
    document.body.style.cursor = "col-resize";
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const max = Math.floor(window.innerWidth * MAX_PEEK_WIDTH_RATIO);
    // 좌측 핸들이므로 왼쪽으로 끌면(negative dx) 폭 증가.
    const next = Math.min(max, Math.max(MIN_PEEK_WIDTH, d.originWidth - dx));
    setWidth(next);
  };
  const onResizeEnd = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* noop */ }
    dragRef.current = null;
    document.body.style.cursor = "";
    localStorage.setItem(PEEK_WIDTH_KEY, String(width));
  };

  if (!peekPageId || !page || !databaseId || !bundle) return null;

  return (
    <div
      onClick={closePeek}
      className="fixed inset-0 z-40 bg-black/30"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="absolute right-0 top-0 flex h-full flex-col overflow-y-auto border-l border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        {/* 좌측 리사이즈 핸들 — hover 시 파란 띠 */}
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          title="피크 너비 조절"
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
        />

        <button
          type="button"
          onClick={closePeek}
          className="mb-4 self-end rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={16} />
        </button>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="제목 없음"
          className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
        />
        <DatabasePropertyPanel databaseId={databaseId} pageId={peekPageId} />
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8 flex flex-1 flex-col">
          <Editor key={peekPageId} pageId={peekPageId} bodyOnly />
        </div>
      </div>
    </div>
  );
}
