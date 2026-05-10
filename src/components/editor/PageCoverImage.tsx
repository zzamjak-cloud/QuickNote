import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { uploadImage } from "../../lib/images/upload";
import { prepareCoverImageForUpload } from "../../lib/images/compressImage";
import { useImageUrl } from "../../lib/images/hooks";

type Props = {
  url?: string | null;
  onChange: (url: string) => void;
  onRemove: () => void;
  /** 업로드·이미지 URL 해석 실패 시 */
  onUploadError?: (message: string) => void;
};

export function PageCoverImage({
  url,
  onChange,
  onRemove,
  onUploadError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { url: displayUrl, error: resolveError } = useImageUrl(url);

  const pickAndUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      onUploadError?.("이미지 파일만 사용할 수 있습니다.");
      return;
    }
    void (async () => {
      setUploading(true);
      try {
        const prepared = await prepareCoverImageForUpload(file);
        const ref = await uploadImage(prepared);
        onChange(ref);
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "커버 이미지를 업로드하지 못했습니다.";
        onUploadError?.(msg);
      } finally {
        setUploading(false);
      }
    })();
  };

  // 커버 이미지가 없을 때: 호버 시 추가 버튼 표시
  if (!url) {
    return (
      <div className="relative flex h-8 items-center px-12 pt-6">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" size={12} />
              업로드 중…
            </>
          ) : (
            "+ 커버 이미지 추가"
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = "";
            if (f) pickAndUpload(f);
          }}
        />
      </div>
    );
  }

  // 커버 이미지가 있을 때: S3 ref · 레거시 data URL 모두 표시
  return (
    <div
      className="relative h-40 w-full overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f?.type.startsWith("image/")) pickAndUpload(f);
      }}
    >
      {displayUrl ? (
        <>
          <img
            src={displayUrl}
            className={`h-full w-full object-cover ${uploading ? "opacity-60" : ""}`}
            alt="커버"
          />
          {uploading ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
              <Loader2 className="animate-spin text-white drop-shadow" size={28} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-100 px-4 text-center text-xs text-zinc-400 dark:bg-zinc-900">
          {resolveError ? (
            <span className="text-red-500 dark:text-red-400">{resolveError}</span>
          ) : uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} />
              업로드 중…
            </span>
          ) : (
            "이미지 불러오는 중…"
          )}
        </div>
      )}
      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded bg-black/40 px-2 py-1 text-[10px] text-white hover:bg-black/60 disabled:opacity-50"
        >
          {uploading ? "처리 중…" : "커버 변경"}
        </button>
        <button
          type="button"
          disabled={uploading}
          onClick={onRemove}
          className="rounded bg-black/40 px-2 py-1 text-[10px] text-white hover:bg-black/60 disabled:opacity-50"
        >
          제거
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) pickAndUpload(f);
        }}
      />
    </div>
  );
}
