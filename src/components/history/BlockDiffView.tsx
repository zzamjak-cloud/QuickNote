import { useMemo } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { useEditorExtensions } from "../editor/useEditorExtensions";
import { EditorErrorBoundary } from "../editor/EditorErrorBoundary";
import { diffDocBlocks, type BlockNode } from "../../lib/history/blockDiff";

/**
 * 버전 히스토리 본문 diff — 변경된 블럭을 실제 블럭 모습 그대로 렌더한다.
 *
 * read-only TipTap 에디터(실제 스키마+NodeView)를 쓰므로 탭 블럭·DB 블럭 등
 * React NodeView 블럭도 본래 모습으로 보인다. 라벨/배지/박스 없이
 * 컬러(빨강=이전·삭제 / 초록=이후·추가)만으로 구분한다.
 */

const MAX_BLOCKS = 20;

function ReadOnlyBlocksPane({
  blocks,
  tone,
}: {
  blocks: BlockNode[];
  tone: "before" | "after";
}) {
  const extensions = useEditorExtensions({
    lowlightApi: null,
    isFullPageDatabase: false,
    effectivePageId: null,
    myMemberId: undefined,
    collabDoc: null,
    collabAwareness: null,
  });
  const content = useMemo<JSONContent>(
    () => ({ type: "doc", content: blocks as JSONContent[] }),
    [blocks],
  );
  const editor = useEditor({ extensions, content, editable: false }, [content]);
  if (!editor) return null;
  const toneClass =
    tone === "before"
      ? "bg-red-50/70 dark:bg-red-950/25"
      : "bg-emerald-50/70 dark:bg-emerald-950/25";
  return (
    <div className={`min-w-0 rounded px-2 py-1 ${toneClass}`}>
      <EditorContent editor={editor} />
    </div>
  );
}

type Props = {
  beforeDoc: unknown;
  afterDoc: unknown;
};

export function BlockDiffView({ beforeDoc, afterDoc }: Props) {
  const diff = useMemo(() => diffDocBlocks(beforeDoc, afterDoc), [beforeDoc, afterDoc]);
  const beforeBlocks = useMemo(
    () => diff.filter((d) => d.before).map((d) => d.before as BlockNode).slice(0, MAX_BLOCKS),
    [diff],
  );
  const afterBlocks = useMemo(
    () => diff.filter((d) => d.after).map((d) => d.after as BlockNode).slice(0, MAX_BLOCKS),
    [diff],
  );
  if (beforeBlocks.length === 0 && afterBlocks.length === 0) return null;
  const bothSides = beforeBlocks.length > 0 && afterBlocks.length > 0;

  return (
    <EditorErrorBoundary>
      <div className={bothSides ? "grid gap-2 md:grid-cols-2" : "grid gap-2"}>
        {beforeBlocks.length > 0 ? (
          <ReadOnlyBlocksPane blocks={beforeBlocks} tone="before" />
        ) : null}
        {afterBlocks.length > 0 ? (
          <ReadOnlyBlocksPane blocks={afterBlocks} tone="after" />
        ) : null}
      </div>
      {diff.length > MAX_BLOCKS ? (
        <div className="px-1 text-xs text-zinc-400">
          외 {diff.length - MAX_BLOCKS}개 블럭 변경 (상위 {MAX_BLOCKS}개만 표시)
        </div>
      ) : null}
    </EditorErrorBoundary>
  );
}
