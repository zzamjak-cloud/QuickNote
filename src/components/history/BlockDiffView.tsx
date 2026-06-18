import { useMemo } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { useEditorExtensions } from "../editor/useEditorExtensions";
import { EditorErrorBoundary } from "../editor/EditorErrorBoundary";
import {
  diffDocBlocks,
  buildUnifiedBlockDiff,
  type BlockNode,
  type UnifiedBlockRow,
} from "../../lib/history/blockDiff";

/**
 * 버전 히스토리 본문 diff — 실제 블럭 모습 그대로(read-only TipTap) 렌더한다.
 * 라벨/배지 없이 컬러만으로 구분한다.
 */

const MAX_BLOCKS = 20;

/** 인라인 DB 블럭은 프리뷰에서 전체 DB 를 렌더하지 않고 컴팩트 플레이스홀더로 대체한다. */
function toPreviewBlock(node: BlockNode): BlockNode {
  if (node.type === "databaseBlock") {
    return {
      type: "paragraph",
      content: [{ type: "text", text: "📊 인라인 데이터베이스 블럭" }],
    };
  }
  return node;
}

type PaneTone = "before" | "after" | "added" | "removed" | "plain";

const TONE_CLASS: Record<PaneTone, string> = {
  before: "rounded bg-red-50/70 px-2 py-1 dark:bg-red-950/25",
  after: "rounded bg-emerald-50/70 px-2 py-1 dark:bg-emerald-950/25",
  added:
    "rounded border-l-2 border-emerald-400 bg-emerald-50/60 px-2 py-1 dark:border-emerald-600 dark:bg-emerald-950/20",
  removed:
    "rounded border-l-2 border-red-400 bg-red-50/60 px-2 py-1 opacity-75 dark:border-red-600 dark:bg-red-950/20",
  plain: "px-2 py-1",
};

function ReadOnlyBlocksPane({ blocks, tone }: { blocks: BlockNode[]; tone: PaneTone }) {
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
  return (
    <div className={`min-w-0 ${TONE_CLASS[tone]}`}>
      <EditorContent editor={editor} />
    </div>
  );
}

type Props = {
  beforeDoc: unknown;
  afterDoc: unknown;
};

/** (구) 좌우 컬럼 방식 — DB 블럭 히스토리 다이얼로그에서 계속 사용. */
export function BlockDiffView({ beforeDoc, afterDoc }: Props) {
  const diff = useMemo(() => diffDocBlocks(beforeDoc, afterDoc), [beforeDoc, afterDoc]);
  const beforeBlocks = useMemo(
    () => diff.filter((d) => d.before).map((d) => toPreviewBlock(d.before as BlockNode)).slice(0, MAX_BLOCKS),
    [diff],
  );
  const afterBlocks = useMemo(
    () => diff.filter((d) => d.after).map((d) => toPreviewBlock(d.after as BlockNode)).slice(0, MAX_BLOCKS),
    [diff],
  );
  if (beforeBlocks.length === 0 && afterBlocks.length === 0) return null;
  const bothSides = beforeBlocks.length > 0 && afterBlocks.length > 0;
  return (
    <EditorErrorBoundary>
      <div className={bothSides ? "grid gap-2 md:grid-cols-2" : "grid gap-2"}>
        {beforeBlocks.length > 0 ? <ReadOnlyBlocksPane blocks={beforeBlocks} tone="before" /> : null}
        {afterBlocks.length > 0 ? <ReadOnlyBlocksPane blocks={afterBlocks} tone="after" /> : null}
      </div>
      {diff.length > MAX_BLOCKS ? (
        <div className="px-1 text-xs text-zinc-400">
          외 {diff.length - MAX_BLOCKS}개 블럭 변경 (상위 {MAX_BLOCKS}개만 표시)
        </div>
      ) : null}
    </EditorErrorBoundary>
  );
}

/**
 * 통합(unified) 본문 뷰 — 선택 버전의 전체 본문을 문서 순서대로 보여주고,
 * 변경 구간만 컬러(추가=녹색·삭제=빨강)로 표시한다. 연속 동일 상태 블럭은
 * 한 read-only 에디터로 묶어 렌더해 에디터 인스턴스 수를 최소화한다.
 */
export function UnifiedBlockDiffView({ beforeDoc, afterDoc }: Props) {
  const rows = useMemo(() => buildUnifiedBlockDiff(beforeDoc, afterDoc), [beforeDoc, afterDoc]);
  const segments = useMemo(() => {
    const segs: { status: UnifiedBlockRow["status"]; blocks: BlockNode[] }[] = [];
    for (const r of rows) {
      const node = toPreviewBlock(r.node);
      const last = segs[segs.length - 1];
      if (last && last.status === r.status) last.blocks.push(node);
      else segs.push({ status: r.status, blocks: [node] });
    }
    return segs;
  }, [rows]);
  if (segments.length === 0) {
    return <div className="px-1 text-sm text-zinc-400">본문이 비어 있습니다.</div>;
  }
  const toneOf = (s: UnifiedBlockRow["status"]): PaneTone =>
    s === "added" ? "added" : s === "removed" ? "removed" : "plain";
  return (
    <EditorErrorBoundary>
      <div className="space-y-0.5">
        {segments.map((seg, i) => (
          <ReadOnlyBlocksPane key={i} blocks={seg.blocks} tone={toneOf(seg.status)} />
        ))}
      </div>
    </EditorErrorBoundary>
  );
}
