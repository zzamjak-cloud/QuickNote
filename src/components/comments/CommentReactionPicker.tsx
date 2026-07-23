import { Suspense, lazy, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { useCustomIconUpload } from "../common/useCustomIconUpload";
import type { CommentReactionTarget } from "../../lib/comments/commentReactions";

const IconPickerEmoji = lazy(() =>
  import("../common/IconPickerEmoji").then((module) => ({ default: module.IconPickerEmoji })),
);

type Props = {
  onPick: (reaction: CommentReactionTarget) => void;
};

type Tab = "emoji" | "custom";

export function CommentReactionPicker({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<Tab>("emoji");
  const [message, setMessage] = useState<string | null>(null);
  const { customIcons, uploading, uploadIconFile } = useCustomIconUpload({
    onMessage: setMessage,
  });

  const handleFile = async (file: File | undefined) => {
    const src = await uploadIconFile(file);
    if (!src) return;
    onPick({ kind: "custom", value: src });
  };

  return (
    <div
      className="w-[320px] rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-700">
        <div className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {(["emoji", "custom"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={[
                "flex-1 rounded px-2 py-1 text-xs",
                tab === item
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              ].join(" ")}
            >
              {item === "emoji" ? "이모지" : "커스텀"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[360px] overflow-hidden p-2">
        {tab === "emoji" ? (
          <Suspense fallback={<div className="py-8 text-center text-xs text-zinc-400">로딩...</div>}>
            <IconPickerEmoji onPick={(emoji) => onPick({ kind: "emoji", value: emoji })} />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {uploading ? <Upload size={14} /> : <ImagePlus size={14} />}
              {uploading ? "업로드 중" : "이미지 추가"}
            </button>
            {message ? (
              <p className="rounded bg-zinc-50 px-2 py-1 text-[11px] leading-4 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                {message}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {customIcons.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-400">
                  등록된 커스텀 이모지가 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-1">
                  {customIcons.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onPick({ kind: "custom", value: item.src })}
                      className="flex h-11 w-full items-center justify-center overflow-hidden rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title={item.label}
                      aria-label={item.label}
                    >
                      <PageIconDisplay
                        icon={item.src}
                        size="md"
                        className="!h-9 !w-9"
                        imgClassName="!h-9 !w-9"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
