import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Upload, X } from "lucide-react";
import { uploadImage } from "../../lib/images/upload";
import { prepareImageFileForUpload } from "../../lib/images/compressImage";
import { insertFileFromFile } from "../../lib/editor/insertFileFromFile";
import { isGifFile } from "../../lib/files/videoCompress";

// 글머리/번호/체크 항목 안에 이미지·파일 블록을 직접 삽입한다.
// 단순 insertContent 만 호출하면 TipTap 이 listItem 스키마 제약(첫 자식이 paragraph 여야 한다는
// 기본 동작) 으로 인해 블록을 listItem 밖으로 lift 시키는 경우가 있다.
// 커서의 가장 가까운 listItem/taskItem 을 찾아 그 안의 paragraph 뒤(=중첩 리스트 앞) 위치에
// 끼워 넣는다. 항목 안이 아니면 기본 insertContent 로 폴백한다.
function insertBlockSmart(
  editor: Editor,
  nodeJSON: { type: string; attrs?: Record<string, unknown> },
): void {
  const { state } = editor;
  const { selection } = state;
  const $from = selection.$from;
  let listItemDepth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name;
    if (name === "listItem" || name === "taskItem") {
      listItemDepth = d;
      break;
    }
  }
  if (listItemDepth < 0) {
    editor.chain().focus().insertContent(nodeJSON).run();
    return;
  }
  // listItem 내부의 첫 paragraph 끝 위치를 계산.
  const listItem = $from.node(listItemDepth);
  const listItemStart = $from.start(listItemDepth);
  let insertPos = listItemStart;
  let foundParagraph = false;
  listItem.content.forEach((child, offset) => {
    if (foundParagraph) return;
    if (child.type.name === "paragraph") {
      insertPos = listItemStart + offset + child.nodeSize;
      foundParagraph = true;
    }
  });
  // paragraph 가 없으면 listItem 의 시작 안쪽에 그대로 삽입.
  if (!foundParagraph) insertPos = listItemStart + 1;
  const nodeType = editor.schema.nodes[nodeJSON.type];
  if (!nodeType) {
    editor.chain().focus().insertContent(nodeJSON).run();
    return;
  }
  const node = nodeType.create(nodeJSON.attrs ?? null);
  // TipTap insertContent/insertContentAt 은 schema 적합성 검사 후 listItem 밖으로
  // 노드를 lift 하는 경우가 있어, listItem 내부 정확한 위치에 꽂기 위해 ProseMirror tr.insert 를 직접 사용한다.
  const tr = editor.state.tr.insert(insertPos, node);
  editor.view.dispatch(tr);
  editor.view.focus();
}

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
    if (!ALLOWED_MIME.has(file.type) && !isGifFile(file)) {
      setError("png, jpeg, webp, gif 만 업로드할 수 있습니다.");
      return;
    }
    void (async () => {
      setUploading(true);
      try {
        if (isGifFile(file)) {
          const ok = await insertFileFromFile(file, (attrs) => {
            if (editor) insertBlockSmart(editor, { type: "fileBlock", attrs });
          });
          if (!ok) {
            setError("GIF를 MP4로 변환해 업로드하지 못했습니다.");
            return;
          }
          onClose();
          return;
        }
        const fileToUpload = await prepareImageFileForUpload(file);
        if (fileToUpload.size > MAX_BYTES) {
          setError(
            `20MB 이하 이미지만 가능합니다 (현재 ${(fileToUpload.size / 1024 / 1024).toFixed(1)}MB).`,
          );
          return;
        }
        const dim = await loadImageDimensions(fileToUpload).catch(() => null);
        const ref = await uploadImage(fileToUpload);
        if (editor) {
          insertBlockSmart(editor, {
            type: "image",
            attrs: {
              src: ref,
              ...(dim ? { width: dim.w, height: dim.h } : {}),
            },
          });
        }
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
