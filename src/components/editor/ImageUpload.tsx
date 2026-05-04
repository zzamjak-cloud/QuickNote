import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Upload, X } from "lucide-react";
import {
  EDITOR_IMAGE_PLACEHOLDER_SRC,
  storeEditorImageBlob,
} from "../../lib/editorImageStorage";

const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
};

export function ImageUpload({ open, onClose, editor }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const insert = (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `5MB 이하 이미지만 가능합니다 (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
      );
      return;
    }
    void (async () => {
      try {
        const qnImageId = await storeEditorImageBlob(file);
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => {
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: "image",
              attrs: {
                src: EDITOR_IMAGE_PLACEHOLDER_SRC,
                qnImageId,
                width: im.naturalWidth,
                height: im.naturalHeight,
              },
            })
            .run();
          URL.revokeObjectURL(url);
          onClose();
        };
        im.onerror = () => {
          URL.revokeObjectURL(url);
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: "image",
              attrs: { src: EDITOR_IMAGE_PLACEHOLDER_SRC, qnImageId },
            })
            .run();
          onClose();
        };
        im.src = url;
      } catch {
        setError("이미지를 저장하지 못했습니다.");
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
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-8 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Upload size={18} />
          파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
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
