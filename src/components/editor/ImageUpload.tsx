import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Upload, X } from "lucide-react";
import { uploadImage } from "../../lib/images/upload";
import { compressImage } from "../../lib/images/compressImage";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
};

export function ImageUpload({ open, onClose, editor }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!open) return null;

  const insert = (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.has(file.type)) {
      setError("png, jpeg, webp, gif 만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `20MB 이하 이미지만 가능합니다 (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
      );
      return;
    }
    void (async () => {
      setUploading(true);
      // 자연 크기는 업로드와 병렬로 측정 — 실패해도 본문 삽입은 진행.
      // GIF는 애니메이션 보존을 위해 압축 생략
      const fileToUpload =
        file.type === "image/gif"
          ? file
          : new File(
              [await compressImage(file)],
              file.name.replace(/\.[^.]+$/, ".webp"),
              { type: "image/webp" },
            );
      const dim = await loadImageDimensions(fileToUpload).catch(() => null);
      try {
        const ref = await uploadImage(fileToUpload);
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: {
              src: ref,
              ...(dim ? { width: dim.w, height: dim.h } : {}),
            },
          })
          .run();
        onClose();
      } catch {
        setError("이미지를 업로드하지 못했습니다.");
      } finally {
        setUploading(false);
      }
    })();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            이미지 업로드
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-8 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Upload size={18} />
          {uploading ? "업로드 중..." : "파일 선택"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) insert(f);
          }}
        />
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

function loadImageDimensions(
  file: File,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const r = { w: im.naturalWidth, h: im.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(r);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    im.src = url;
  });
}
