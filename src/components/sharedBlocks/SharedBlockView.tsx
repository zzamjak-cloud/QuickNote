import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  GripVertical,
  Images,
  Languages,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { newId } from "../../lib/id";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { usePageStore } from "../../store/pageStore";
import { flushSharedBlockHostPageDoc } from "./sharedBlockHostPageFlush";
import {
  sharedBlockRecordKey,
  useSharedBlockStore,
} from "../../store/sharedBlockStore";
import {
  fetchSharedBlockApi,
  pushSharedBlockApi,
} from "../../lib/sync/sharedBlockApi";
import { openPageInCurrentTab } from "../../lib/navigation/internalNavigation";
import { loadMergedMentionItems } from "../../lib/comments/mentionItems";
import { stripPagePrefix } from "../../lib/tiptapExtensions/mentionKind";
import { uploadImage } from "../../lib/images/upload";
import { prepareImageFileForUpload } from "../../lib/images/compressImage";
import { useImageUrl } from "../../lib/images/hooks";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { DialogBase } from "../../lib/ui-primitives/DialogBase";
import type { MentionListItem } from "../../lib/comments/mentionItems";
import type { SharedBlockAttrs } from "../../lib/tiptapExtensions/sharedBlocks";
import {
  MAX_GALLERY_HEIGHT_PX,
  MIN_GALLERY_HEIGHT_PX,
  emptyDropdownMenu,
  emptyGallery,
  normalizeGalleryHeightPx,
  normalizeSharedBlockAlign,
  parseDropdownMenuData,
  parseGalleryData,
  serializeSharedBlockData,
  type DropdownMenuData,
  type DropdownMenuItem,
  type GalleryData,
  type GalleryImage,
  type SharedBlockData,
  type SharedBlockKind,
} from "../../types/sharedBlock";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

type SharedBlockViewProps = NodeViewProps & {
  expectedKind: SharedBlockKind;
};

function ResolvedImage({
  image,
  className,
  onClick,
}: {
  image: GalleryImage;
  className: string;
  onClick?: () => void;
}) {
  const { url, error, reportLoadError } = useImageUrl(image.src);
  if (!url || error) {
    return (
      <div className={`${className} flex items-center justify-center bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800`}>
        이미지를 불러오지 못했습니다.
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={image.alt}
      draggable={false}
      onError={reportLoadError}
      onClick={onClick}
      className={className}
    />
  );
}

function ModalFrame({
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
  closeOnEsc = true,
  zClassName = "z-[520]",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeOnEsc?: boolean;
  zClassName?: string;
}) {
  const labelId = `shared-block-dialog-${title.replace(/\s+/g, "-")}`;
  return (
    <DialogBase
      open
      onClose={onClose}
      closeOnEsc={closeOnEsc}
      widthClassName={wide ? "max-w-3xl" : "max-w-xl"}
      labelId={labelId}
      zClassName={zClassName}
    >
      <div className="flex max-h-[78dvh] min-h-0 flex-col">
        <header className="flex shrink-0 items-start gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h2 id={labelId} className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto py-5">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {footer}
          </footer>
        ) : null}
      </div>
    </DialogBase>
  );
}

function PageMentionPicker({
  onPick,
  onClose,
}: {
  onPick: (pageId: string, label: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<MentionListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void loadMergedMentionItems(value, 24, { includeRemoteMembers: false }).then(
        (items) => {
          if (cancelled) return;
          setRows(items.filter((item) => item.mentionKind === "page"));
          setLoading(false);
        },
        () => {
          if (cancelled) return;
          setRows([]);
          setLoading(false);
        },
      );
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <ModalFrame title="페이지 연결" description="메뉴를 클릭했을 때 열 페이지를 선택합니다." onClose={onClose} zClassName="z-[530]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="페이지 제목 검색"
          className="w-full rounded-xl border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-violet-950"
        />
      </div>
      <div className="mt-3 h-64 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
        {!query.trim() ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-400">
            연결할 페이지의 제목을 입력하세요.
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">일치하는 페이지가 없습니다.</div>
        ) : (
          rows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(stripPagePrefix(item.id), item.label)}
              className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left last:border-0 hover:bg-violet-50 dark:border-zinc-800 dark:hover:bg-violet-950/30"
            >
              <FileText className="h-4 w-4 shrink-0 text-violet-500" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {item.label}
              </span>
              {item.subtitle ? (
                <span className="shrink-0 text-[10px] text-zinc-400">{item.subtitle}</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </ModalFrame>
  );
}

function DropdownMenuEditorDialog({
  initial,
  onSave,
  onClose,
  saving,
  saveError,
}: {
  initial: DropdownMenuData;
  onSave: (data: DropdownMenuData) => void | Promise<void>;
  onClose: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [items, setItems] = useState<DropdownMenuItem[]>(initial.items);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const pageIds = items.map((item) => item.pageId).filter(Boolean);
  const hasDuplicatePage = new Set(pageIds).size !== pageIds.length;
  const canSave =
    items.length > 0 &&
    items.every((item) => item.label.trim().length > 0 && item.pageId.length > 0) &&
    !hasDuplicatePage;

  const updateItem = (id: string, patch: Partial<DropdownMenuItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const moveItem = (index: number, delta: number) => {
    setItems((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  };

  return (
    <>
      <ModalFrame
        title="드롭다운 메뉴 편집"
        description="메뉴 이름과 페이지 멘션을 연결합니다. 복제된 모든 블록에 같은 내용이 반영됩니다."
        onClose={onClose}
        wide
        closeOnEsc={!pickingId}
        footer={
          <>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              취소
            </button>
            <button
              type="button"
              disabled={!canSave || saving}
              onClick={() => void onSave({
                kind: "dropdown-menu",
                items: items.map((item) => ({ ...item, label: item.label.trim() })),
              })}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "저장 중…" : "변경사항 저장"}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-700">
              <Languages className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">첫 메뉴를 추가하세요.</p>
              <p className="mt-1 text-xs text-zinc-500">예: 한국어 → 제품 소개 (kr)</p>
            </div>
          ) : null}
          {items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-800/40">
              <GripVertical className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
              <input
                value={item.label}
                onChange={(event) => updateItem(item.id, { label: event.target.value })}
                placeholder="메뉴 이름"
                aria-label={`${index + 1}번 메뉴 이름`}
                className="min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => setPickingId(item.id)}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
              >
                <FileText className="h-4 w-4 shrink-0 text-violet-500" />
                <span className={`truncate ${item.pageId ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-400"}`}>
                  {item.pageId ? item.pageLabel || "연결된 페이지" : "페이지 멘션 연결"}
                </span>
              </button>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} aria-label="위로 이동" className="rounded-md p-1.5 text-zinc-500 hover:bg-white disabled:opacity-25 dark:hover:bg-zinc-700"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1} aria-label="아래로 이동" className="rounded-md p-1.5 text-zinc-500 hover:bg-white disabled:opacity-25 dark:hover:bg-zinc-700"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} aria-label="메뉴 삭제" className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && !canSave ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {hasDuplicatePage
              ? "같은 페이지를 두 메뉴에 중복 연결할 수 없습니다."
              : "각 메뉴의 이름과 연결 페이지를 모두 설정하세요."}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{saveError}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setItems((current) => [...current, { id: newId(), label: "", pageId: "", pageLabel: "" }])}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
        >
          <Plus className="h-4 w-4" /> 메뉴 추가
        </button>
      </ModalFrame>
      {pickingId ? (
        <PageMentionPicker
          onClose={() => setPickingId(null)}
          onPick={(pageId, label) => {
            updateItem(pickingId, {
              pageId,
              pageLabel: label,
              label: items.find((item) => item.id === pickingId)?.label || label,
            });
            setPickingId(null);
          }}
        />
      ) : null}
    </>
  );
}

function GalleryEditorDialog({
  initial,
  onSave,
  onClose,
  saving,
  saveError,
}: {
  initial: GalleryData;
  onSave: (data: GalleryData) => void | Promise<void>;
  onClose: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [images, setImages] = useState(initial.images);
  const [intervalMs, setIntervalMs] = useState(initial.intervalMs);
  const [heightPx, setHeightPx] = useState(() => normalizeGalleryHeightPx(initial.heightPx));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const moveImage = (index: number, delta: number) => {
    setImages((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  };

  const uploadFiles = async (files: File[]) => {
    setError(null);
    setUploading(true);
    const added: GalleryImage[] = [];
    try {
      for (const file of files) {
        if (!ALLOWED_IMAGE_MIME.has(file.type)) {
          throw new Error("PNG, JPEG, WebP 이미지만 등록할 수 있습니다.");
        }
        const prepared = await prepareImageFileForUpload(file);
        if (prepared.size > MAX_IMAGE_BYTES) {
          throw new Error("20MB 이하 이미지만 등록할 수 있습니다.");
        }
        const src = await uploadImage(prepared);
        added.push({ id: newId(), src, alt: file.name.replace(/\.[^.]+$/, "") });
      }
      setImages((current) => [...current, ...added]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이미지를 등록하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ModalFrame
      title="갤러리 편집"
      description="배너 순서, 블록 높이와 전환 간격을 설정합니다. 복제된 모든 갤러리에 같은 내용이 반영됩니다."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">취소</button>
          <button type="button" disabled={saving || uploading} onClick={() => void onSave({ kind: "gallery", images, intervalMs, heightPx })} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "저장 중…" : "변경사항 저장"}</button>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300"
        >
          <Upload className="h-4 w-4" /> {uploading ? "업로드 중…" : "이미지 추가"}
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            블록 높이
            <input
              type="range"
              aria-label="갤러리 높이"
              min={MIN_GALLERY_HEIGHT_PX}
              max={MAX_GALLERY_HEIGHT_PX}
              step={20}
              value={heightPx}
              onChange={(event) => setHeightPx(Number(event.target.value))}
              className="w-28 accent-violet-600"
            />
            <output className="w-12 text-right tabular-nums">{heightPx}px</output>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            전환 간격
            <select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-zinc-600 dark:bg-zinc-950">
              <option value={3000}>3초</option>
              <option value={5000}>5초</option>
              <option value={8000}>8초</option>
              <option value={10000}>10초</option>
            </select>
          </label>
        </div>
        <input ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void uploadFiles(files); }} />
      </div>
      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {saveError ? <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{saveError}</p> : null}
      <div className="mt-4 space-y-2">
        {images.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-12 text-center dark:border-zinc-700">
            <Images className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">롤링할 이미지를 추가하세요.</p>
          </div>
        ) : null}
        {images.map((image, index) => (
          <div key={image.id} className="grid grid-cols-[auto_7rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-800/40">
            <GripVertical className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
            <ResolvedImage image={image} className="h-16 w-28 rounded-lg object-cover" />
            <input value={image.alt} onChange={(event) => setImages((current) => current.map((row) => row.id === image.id ? { ...row, alt: event.target.value } : row))} aria-label={`${index + 1}번 이미지 설명`} placeholder="이미지 설명" className="min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100" />
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="앞으로 이동" className="rounded-md p-1.5 text-zinc-500 hover:bg-white disabled:opacity-25 dark:hover:bg-zinc-700"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1} aria-label="뒤로 이동" className="rounded-md p-1.5 text-zinc-500 hover:bg-white disabled:opacity-25 dark:hover:bg-zinc-700"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setImages((current) => current.filter((row) => row.id !== image.id))} aria-label="이미지 삭제" className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </ModalFrame>
  );
}

function GalleryPreviewDialog({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  if (!image) return null;
  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-[540] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="갤러리 이미지 미리보기" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="미리보기 닫기" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="h-5 w-5" /></button>
      {images.length > 1 ? (
        <button type="button" onClick={() => onIndexChange((index - 1 + images.length) % images.length)} aria-label="이전 이미지" className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><ArrowLeft className="h-5 w-5" /></button>
      ) : null}
      <ResolvedImage image={image} className="max-h-[85dvh] max-w-[90vw] rounded-xl object-contain shadow-2xl" />
      {images.length > 1 ? (
        <button type="button" onClick={() => onIndexChange((index + 1) % images.length)} aria-label="다음 이미지" className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><ArrowRight className="h-5 w-5" /></button>
      ) : null}
      <div className="absolute bottom-4 rounded-full bg-black/55 px-3 py-1 text-xs text-white/90">{index + 1} / {images.length}</div>
    </div>,
    document.body,
  );
}

function DropdownMenuView({
  data,
  editable,
  selected,
  publicMode,
  onEdit,
}: {
  data: DropdownMenuData;
  editable: boolean;
  selected: boolean;
  publicMode: boolean;
  onEdit: () => void;
}) {
  const popover = useAnchoredPopover(320);
  const activePageId = usePageStore((state) => publicMode ? null : state.activePageId);
  const active = data.items.find((item) => item.active || (!publicMode && item.pageId === activePageId)) ?? data.items[0];
  const menuWidth = () => Math.min(320, window.innerWidth - 16);
  const focusOption = (position: "first" | "last") => {
    window.setTimeout(() => {
      const options = popover.popoverRef.current?.querySelectorAll<HTMLElement>("[role='option']:not([disabled])");
      const target = position === "first" ? options?.[0] : options?.[options.length - 1];
      target?.focus();
    }, 0);
  };

  return (
    <div className={`relative my-2 inline-flex w-fit max-w-full items-center gap-1.5 rounded-xl ${selected ? "ring-2 ring-violet-400 ring-offset-2 dark:ring-offset-zinc-950" : ""}`}>
      <button
        ref={popover.buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        onClick={() => popover.toggle(menuWidth())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            popover.openPopover(menuWidth());
            focusOption(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-violet-700 dark:hover:bg-violet-950/25"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Languages className="h-4 w-4" /></span>
        <span className={`min-w-0 max-w-96 truncate ${active ? "" : "text-zinc-400"}`}>{active?.label || "메뉴를 설정하세요"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${popover.open ? "rotate-180" : ""}`} />
      </button>
      {editable ? (
        <button type="button" onClick={onEdit} aria-label="드롭다운 메뉴 편집" title="드롭다운 메뉴 편집" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-violet-700 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"><Pencil className="h-4 w-4" /></button>
      ) : null}
      {popover.open && popover.coords ? createPortal(
        <div
          ref={popover.popoverRef}
          role="listbox"
          style={{ position: "fixed", top: popover.coords.top, left: popover.coords.left, width: Math.min(320, window.innerWidth - 16) }}
          className="z-[500] max-h-[min(22rem,calc(100dvh-1rem))] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onKeyDown={(event) => {
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='option']:not([disabled])"));
            const current = options.indexOf(document.activeElement as HTMLElement);
            let next = current;
            if (event.key === "ArrowDown") next = Math.min(options.length - 1, current + 1);
            else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else if (event.key === "Escape") {
              event.preventDefault();
              popover.close();
              popover.buttonRef.current?.focus();
              return;
            } else return;
            event.preventDefault();
            options[next]?.focus();
          }}
        >
          {data.items.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-zinc-400">연결된 메뉴가 없습니다.</div>
          ) : (
            data.items.map((item) => {
              const isActive = item.active || (!publicMode && item.pageId === activePageId);
              const className = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-violet-50 hover:text-violet-800 dark:text-zinc-200 dark:hover:bg-violet-950/40 dark:hover:text-violet-200";
              const content = <><span className="min-w-0 flex-1 truncate">{item.label || "이름 없는 메뉴"}</span>{isActive ? <Check className="h-4 w-4 shrink-0 text-violet-600" /> : null}</>;
              return publicMode && item.href ? (
                <a key={item.id} role="option" aria-selected={isActive} aria-current={isActive ? "page" : undefined} href={item.href} onClick={popover.close} className={className}>{content}</a>
              ) : (
                <button key={item.id} type="button" role="option" aria-selected={isActive} aria-current={isActive ? "page" : undefined} disabled={!item.pageId} onClick={() => { if (item.pageId) openPageInCurrentTab(item.pageId); popover.close(); }} className={`${className} min-h-11 disabled:cursor-not-allowed disabled:opacity-40`}>{content}</button>
              );
            })
          )}
        </div>
      , document.body) : null}
    </div>
  );
}

function GalleryView({
  data,
  editable,
  selected,
  onEdit,
}: {
  data: GalleryData;
  editable: boolean;
  selected: boolean;
  onEdit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [documentHidden, setDocumentHidden] = useState(document.visibilityState === "hidden");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const images = data.images;
  const heightPx = normalizeGalleryHeightPx(data.heightPx);
  const visualIndex = images.length ? index % images.length : 0;
  const trackImages = images.length > 1 ? [...images, images[0]!] : images;
  const autoPaused = hovered || manuallyPaused || documentHidden || previewIndex != null;
  const closePreview = useCallback(() => {
    setPreviewIndex(null);
    // Portal이 열리는 순간의 mouseenter 상태가 남아 자동재생이 영구 정지하지 않게 한다.
    setHovered(false);
  }, []);

  useEffect(() => {
    setTransitionEnabled(false);
    setIndex((current) => (images.length ? Math.min(current % images.length, images.length - 1) : 0));
    let resumeFrame = 0;
    const resetFrame = window.requestAnimationFrame(() => {
      resumeFrame = window.requestAnimationFrame(() => setTransitionEnabled(true));
    });
    return () => {
      window.cancelAnimationFrame(resetFrame);
      window.cancelAnimationFrame(resumeFrame);
    };
  }, [images.length]);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || autoPaused || images.length < 2) return;
    const timer = window.setInterval(() => {
      setTransitionEnabled(true);
      setIndex((current) => current + 1);
    }, data.intervalMs);
    return () => window.clearInterval(timer);
  }, [autoPaused, data.intervalMs, images.length]);

  useEffect(() => {
    const onVisibilityChange = () => setDocumentHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const resetLoopIfNeeded = () => {
    if (images.length < 2 || index !== images.length) return;
    setTransitionEnabled(false);
    setIndex(0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    });
  };

  if (!editable && images.length === 0) return null;

  return (
    <div role="region" aria-label="롤링 갤러리" aria-roledescription="carousel" className={`group relative my-3 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${selected ? "ring-2 ring-violet-400 ring-offset-2 dark:ring-offset-zinc-950" : ""}`} style={{ height: heightPx }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {editable ? (
        <button type="button" onClick={onEdit} aria-label="갤러리 편집" title="갤러리 편집" className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-black/45 text-white shadow-lg backdrop-blur transition-colors hover:bg-black/70"><Pencil className="h-4 w-4" /></button>
      ) : null}
      {images.length === 0 ? (
        <button type="button" disabled={!editable} onClick={onEdit} className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-400 disabled:cursor-default">
          <Images className="h-9 w-9" />
          <span className="text-sm">{editable ? "편집 버튼에서 배너 이미지를 추가하세요." : "등록된 이미지가 없습니다."}</span>
        </button>
      ) : (
        <>
          <div aria-live="off" onTransitionEnd={resetLoopIfNeeded} className={`flex h-full ease-out motion-reduce:transition-none ${transitionEnabled ? "transition-transform duration-500" : "transition-none"}`} style={{ transform: `translateX(-${index * 100}%)` }}>
            {trackImages.map((image, imageIndex) => {
              const sourceIndex = imageIndex % images.length;
              const isVisible = imageIndex === index;
              return (
              <button key={`${image.id}-${imageIndex}`} type="button" tabIndex={isVisible ? 0 : -1} aria-hidden={!isVisible} onClick={() => setPreviewIndex(sourceIndex)} aria-label={`${image.alt || `갤러리 이미지 ${sourceIndex + 1}`} 미리보기`} className="h-full w-full shrink-0 overflow-hidden bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 dark:bg-zinc-800">
                <ResolvedImage image={image} className="h-full w-full cursor-zoom-in object-contain" />
              </button>
              );
            })}
          </div>
          {images.length > 1 ? (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-2 py-1 backdrop-blur-sm">
              <button type="button" onClick={() => setManuallyPaused((value) => !value)} aria-label={manuallyPaused ? "갤러리 자동 재생" : "갤러리 일시정지"} aria-pressed={manuallyPaused} className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                {manuallyPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
              {images.map((image, dotIndex) => (
                <button key={image.id} type="button" onClick={() => { setTransitionEnabled(true); setIndex(dotIndex); }} aria-label={`${dotIndex + 1}번 이미지 보기`} className={`h-2 rounded-full transition-all ${dotIndex === visualIndex ? "w-5 bg-white" : "w-2 bg-white/55 hover:bg-white/80"}`} />
              ))}
            </div>
          ) : null}
        </>
      )}
      {previewIndex != null ? (
        <GalleryPreviewDialog images={images} index={previewIndex} onIndexChange={setPreviewIndex} onClose={closePreview} />
      ) : null}
    </div>
  );
}

function SharedBlockView({
  node,
  selected,
  updateAttributes,
  editor,
  expectedKind,
}: SharedBlockViewProps) {
  const attrs = node.attrs as SharedBlockAttrs;
  const sharedBlockId = typeof attrs.sharedBlockId === "string" ? attrs.sharedBlockId : "";
  const publicMode = attrs.publicMode === true;
  const align = normalizeSharedBlockAlign(attrs.align);
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? null);
  const inlineData = useMemo<SharedBlockData>(() =>
    expectedKind === "gallery" ? parseGalleryData(attrs.data) : parseDropdownMenuData(attrs.data),
  [attrs.data, expectedKind]);
  const storeRecord = useSharedBlockStore((state) =>
    !publicMode && sharedBlockId
      ? state.records[sharedBlockRecordKey(workspaceId, sharedBlockId)]
      : undefined,
  );
  // seedIfAbsent 가 만든 updatedAt=0 레코드는 서버 권위값이 아니라 "마운트된 복제본 동기화 슬롯"이다.
  // 새로고침 후 페이지 JSON 의 인라인 스냅샷에 이미지가 있는데 오래된 빈 seed 가 persist 돼 있으면
  // seed 가 inline data 를 가려 갤러리가 사라져 보일 수 있으므로, 실제 원격/저장 레코드만 우선한다.
  const authoritativeStoreRecord = storeRecord
    && storeRecord.updatedAt > 0
    && !storeRecord.deletedAt
    && storeRecord.kind === expectedKind
    ? storeRecord
    : null;
  const data = authoritativeStoreRecord
    ? authoritativeStoreRecord.data
    : inlineData;
  const seedIfAbsent = useSharedBlockStore((state) => state.seedIfAbsent);
  const applyRemote = useSharedBlockStore((state) => state.applyRemote);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = useCallback(() => {
    setSaveError(null);
    setEditing(true);
  }, []);

  const closeEditor = useCallback(() => {
    if (saving) return;
    setSaveError(null);
    setEditing(false);
  }, [saving]);

  const flushHostPageDoc = useCallback(() => {
    flushSharedBlockHostPageDoc(editor);
  }, [editor]);

  useEffect(() => {
    if (
      expectedKind !== "gallery" ||
      publicMode ||
      !editor.isEditable ||
      attrs.autoOpenEditor !== true
    ) return;
    openEditor();
    updateAttributes({ autoOpenEditor: false });
    flushHostPageDoc();
  }, [attrs.autoOpenEditor, editor.isEditable, expectedKind, flushHostPageDoc, openEditor, publicMode, updateAttributes]);

  useEffect(() => {
    if (publicMode || !sharedBlockId) return;
    if (!workspaceId) return;
    let cancelled = false;
    void fetchSharedBlockApi(sharedBlockId, workspaceId).then((record) => {
      if (!cancelled && record?.kind === expectedKind) applyRemote(record);
    });
    return () => {
      cancelled = true;
    };
  }, [applyRemote, expectedKind, publicMode, sharedBlockId, workspaceId]);

  useEffect(() => {
    if (publicMode || !editor.isEditable) return;
    if (!sharedBlockId) {
      const id = newId();
      seedIfAbsent({ id, workspaceId, kind: expectedKind, data: inlineData });
      updateAttributes({ sharedBlockId: id });
      flushHostPageDoc();
      return;
    }
    seedIfAbsent({ id: sharedBlockId, workspaceId, kind: expectedKind, data: inlineData });
  }, [editor.isEditable, expectedKind, flushHostPageDoc, inlineData, publicMode, seedIfAbsent, sharedBlockId, updateAttributes, workspaceId]);

  const persist = useCallback(async (next: SharedBlockData) => {
    if (!sharedBlockId || !workspaceId || next.kind !== expectedKind) {
      setSaveError("공유 블록을 저장할 워크스페이스를 확인하지 못했습니다.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    // 서버 저장 성공 전에는 다른 복제본과 인라인 스냅샷을 바꾸지 않는다.
    // 실패 후 취소했을 때 로컬만 앞선 상태로 남는 분기를 막기 위함이다.
    const record = {
      id: sharedBlockId,
      workspaceId,
      kind: expectedKind,
      data: next,
      updatedAt: Date.now(),
      deletedAt: null,
    };
    const remote = await pushSharedBlockApi(record);
    if (!remote || remote.workspaceId !== workspaceId || remote.kind !== expectedKind) {
      setSaving(false);
      setSaveError("서버에 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.");
      return;
    }
    const applied = applyRemote(remote);
    const latest = applied
      ? remote
      : useSharedBlockStore.getState().records[sharedBlockRecordKey(workspaceId, sharedBlockId)] ?? remote;
    if (latest.kind === expectedKind && !latest.deletedAt) {
      updateAttributes({ data: serializeSharedBlockData(latest.data) });
      flushHostPageDoc();
    }
    setSaving(false);
    setEditing(false);
  }, [applyRemote, expectedKind, flushHostPageDoc, sharedBlockId, updateAttributes, workspaceId]);

  return (
    <NodeViewWrapper
      className={`not-prose ${expectedKind === "dropdown-menu" ? `flex w-full ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"}` : ""}`}
      contentEditable={false}
      data-shared-block-kind={expectedKind}
      data-align={align}
    >
      {expectedKind === "dropdown-menu" ? (
        <DropdownMenuView data={data.kind === "dropdown-menu" ? data : emptyDropdownMenu()} editable={editor.isEditable && !publicMode} selected={selected} publicMode={publicMode} onEdit={openEditor} />
      ) : (
        <GalleryView data={data.kind === "gallery" ? data : emptyGallery()} editable={editor.isEditable && !publicMode} selected={selected} onEdit={openEditor} />
      )}
      {editing && expectedKind === "dropdown-menu" ? (
        <DropdownMenuEditorDialog initial={data.kind === "dropdown-menu" ? data : emptyDropdownMenu()} onSave={persist} onClose={closeEditor} saving={saving} saveError={saveError} />
      ) : null}
      {editing && expectedKind === "gallery" ? (
        <GalleryEditorDialog initial={data.kind === "gallery" ? data : emptyGallery()} onSave={persist} onClose={closeEditor} saving={saving} saveError={saveError} />
      ) : null}
    </NodeViewWrapper>
  );
}

export function DropdownMenuBlockView(props: NodeViewProps) {
  return <SharedBlockView {...props} expectedKind="dropdown-menu" />;
}

export function GalleryBlockView(props: NodeViewProps) {
  return <SharedBlockView {...props} expectedKind="gallery" />;
}
