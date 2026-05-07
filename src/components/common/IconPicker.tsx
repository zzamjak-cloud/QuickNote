import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ImagePlus, Plus } from "lucide-react";
import { insertImageFromFile, MAX_EDITOR_IMAGE_BYTES } from "../../lib/editor/insertImageFromFile";
import { isImageLikePageIcon } from "../../lib/pageIcon";
import { PageIconDisplay } from "./PageIconDisplay";

const LazyIconPickerEmoji = lazy(() =>
  import("./IconPickerEmoji").then((m) => ({ default: m.IconPickerEmoji })),
);

const MAX_ICON_BYTES = Math.min(5 * 1024 * 1024, MAX_EDITOR_IMAGE_BYTES);

type Props = {
  current: string | null;
  onChange: (icon: string | null) => void;
  // 인라인 컴팩트 모드: 사이드바·트리에서 작은 아이콘 버튼만 노출
  size?: "lg" | "sm";
  /** 이미지 업로드 실패·용량 초과 시 알림 */
  onUploadMessage?: (message: string) => void;
};

// 카테고리 탭 + 검색이 내장된 emoji-picker-react 기반 아이콘 picker.
export function IconPicker({
  current,
  onChange,
  size = "lg",
  onUploadMessage,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const trigger =
    size === "lg" ? (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md text-3xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          isImageLikePageIcon(current) ? (
            <PageIconDisplay icon={current} size="lg" />
          ) : (
            <span className="leading-none">{current}</span>
          )
        ) : (
          <Plus size={18} className="text-zinc-400" />
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          isImageLikePageIcon(current) ? (
            <PageIconDisplay icon={current} size="sm" />
          ) : (
            <span className="leading-none">{current}</span>
          )
        ) : (
          "·"
        )}
      </button>
    );

  const onPickImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const ok = await insertImageFromFile(
      file,
      (attrs) => {
        onChange(attrs.src);
        setOpen(false);
      },
      {
        maxBytes: MAX_ICON_BYTES,
        onSizeExceeded: (mb) => {
          onUploadMessage?.(`아이콘 이미지는 ${(MAX_ICON_BYTES / 1024 / 1024).toFixed(0)}MB 이하만 가능합니다 (현재 ${mb.toFixed(1)}MB).`);
        },
      },
    );
    if (!ok && file.size <= MAX_ICON_BYTES) {
      onUploadMessage?.("이미지 업로드에 실패했습니다.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="relative" ref={ref}>
      {trigger}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickImageFile(e.target.files?.[0])}
      />
      {open && (
        <div className="absolute left-0 top-14 z-50 rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <Suspense
            fallback={
              <div className="h-[380px] w-[320px] animate-pulse bg-zinc-100 dark:bg-zinc-800" />
            }
          >
            <LazyIconPickerEmoji
              onPick={(emoji) => {
                onChange(emoji);
                setOpen(false);
              }}
            />
          </Suspense>
          <div className="flex flex-col gap-0.5 border-t border-zinc-200 p-1.5 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <ImagePlus size={14} className="shrink-0 text-zinc-500" />
              이미지 업로드
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
            >
              아이콘 제거
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
