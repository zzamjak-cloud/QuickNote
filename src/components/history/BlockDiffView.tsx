import { useMemo } from "react";
import { generateHTML } from "@tiptap/core";
import { useEditorExtensions } from "../editor/useEditorExtensions";
import { diffDocBlocks, type BlockNode } from "../../lib/history/blockDiff";

/**
 * 버전 히스토리 본문 diff — 변경된 블럭을 실제 블럭 모습 그대로 렌더한다.
 *
 * 에디터 인스턴스 대신 generateHTML(스키마 직렬화)로 정적 렌더해 가볍다.
 * 결과 HTML 을 .ProseMirror 래퍼에 넣어 에디터와 동일한 CSS 가 적용된다.
 * React NodeView 전용 임베드(DB 블럭 등)는 renderHTML 폴백 모습으로 보인다.
 */

const MAX_CARDS = 20;

function blockFallbackText(node: BlockNode): string {
  const collect = (n: unknown): string => {
    if (!n || typeof n !== "object") return "";
    const rec = n as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    return Array.isArray(rec.content) ? rec.content.map(collect).join("") : "";
  };
  const text = collect(node).trim();
  return text || `${String(node.type ?? "블럭")} 블럭`;
}

function BlockPane({
  html,
  node,
  tone,
}: {
  html: string | null;
  node: BlockNode;
  tone: "before" | "after";
}) {
  const toneClass =
    tone === "before"
      ? "bg-red-50/70 dark:bg-red-950/25"
      : "bg-emerald-50/70 dark:bg-emerald-950/25";
  return (
    <div className={`min-w-0 rounded px-2 py-1 ${toneClass}`}>
      {html ? (
        <div
          className="ProseMirror pointer-events-none !min-h-0 !p-0 text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="break-words text-sm text-zinc-600 dark:text-zinc-300">
          {blockFallbackText(node)}
        </div>
      )}
    </div>
  );
}

type Props = {
  beforeDoc: unknown;
  afterDoc: unknown;
};

export function BlockDiffView({ beforeDoc, afterDoc }: Props) {
  const extensions = useEditorExtensions({
    lowlightApi: null,
    isFullPageDatabase: false,
    effectivePageId: null,
    myMemberId: undefined,
    collabDoc: null,
    collabAwareness: null,
  });

  const cards = useMemo(() => {
    const toHtml = (node: BlockNode | null): string | null => {
      if (!node) return null;
      try {
        return generateHTML({ type: "doc", content: [node] }, extensions);
      } catch {
        // 스키마에 없는 레거시 노드 등 — 텍스트 폴백으로 표시
        return null;
      }
    };
    return diffDocBlocks(beforeDoc, afterDoc).map((entry) => ({
      ...entry,
      beforeHtml: toHtml(entry.before),
      afterHtml: toHtml(entry.after),
    }));
  }, [beforeDoc, afterDoc, extensions]);

  if (cards.length === 0) return null;
  const visible = cards.slice(0, MAX_CARDS);

  // 라벨·배지·카드 박스 없이 변경 블럭 내용 + 컬러만 — 색(빨강=이전/삭제, 초록=이후/추가)으로 구분한다.
  return (
    <div className="space-y-1.5">
      {visible.map((card) => (
        <div key={`${card.kind}:${card.id}`} className="space-y-1">
          {card.before ? <BlockPane html={card.beforeHtml} node={card.before} tone="before" /> : null}
          {card.after ? <BlockPane html={card.afterHtml} node={card.after} tone="after" /> : null}
        </div>
      ))}
      {cards.length > MAX_CARDS ? (
        <div className="px-1 text-xs text-zinc-400">
          외 {cards.length - MAX_CARDS}개 블럭 변경 (상위 {MAX_CARDS}개만 표시)
        </div>
      ) : null}
    </div>
  );
}
