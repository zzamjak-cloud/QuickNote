import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Upload, X } from "lucide-react";

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
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      editor?.chain().focus().setImage({ src: dataUrl }).run();
      onClose();
    };
    reader.onerror = () => setError("이미지를 읽지 못했습니다.");
    reader.readAsDataURL(file);
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) insert(file);
          }}
          className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-zinc-300 px-4 py-8 text-sm text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
        >
          <Upload size={20} />
          <span>클릭 또는 드래그하여 이미지 선택 (≤ 5MB)</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) insert(file);
            e.target.value = "";
          }}
        />
        {error && (
          <p className="mt-2 text-xs text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
