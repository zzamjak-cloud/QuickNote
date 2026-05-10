import { useRef } from "react";

type Props = {
  url?: string | null;
  onChange: (url: string) => void;
  onRemove: () => void;
};

export function PageCoverImage({ url, onChange, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 파일을 읽어 data URL로 변환 후 상위에 전달
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onChange(e.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  // 커버 이미지가 없을 때: 호버 시 추가 버튼 표시
  if (!url) {
    return (
      <div className="relative flex h-8 items-center px-12 pt-6">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          + 커버 이미지 추가
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
    );
  }

  // 커버 이미지가 있을 때: 이미지 표시 + 변경/제거 버튼
  return (
    <div
      className="relative h-40 w-full overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f?.type.startsWith("image/")) handleFile(f);
      }}
    >
      <img src={url} className="h-full w-full object-cover" alt="커버" />
      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded bg-black/40 px-2 py-1 text-[10px] text-white hover:bg-black/60"
        >
          커버 변경
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded bg-black/40 px-2 py-1 text-[10px] text-white hover:bg-black/60"
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
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}
