import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { usePageStore } from "../../../store/pageStore";
import { isAttachmentBlockNodeType, isCalloutBlockNodeType } from "../../../lib/blocks/uiPolicy";
import { isHeaderColActive, isHeaderRowActive } from "../../../lib/editor/tableHeaders";
import { getConvertibleLinkHref } from "../../../lib/editor/linkBlockConvert";
import type { HoverInfo } from "./helpers";

// BlockHandles 의 블록 타입 판별 플래그 묶음 — hover/editor(읽기 전용 doc 조회)만 의존하는
// 순수 파생. 부수효과·ref·React 훅 없음(usePageStore.getState() 명령형 read 는 원본과 동일).
// 매 렌더 호출되는 plain 계산이라 useMemo 를 추가하지 않는다(로직 보존).
export function computeBlockTypeFlags(hover: HoverInfo | null, editor: Editor | null) {
  const isDatabaseBlock = hover?.node.type.name === "database";
  const isDatabaseFullPage = isDatabaseBlock && hover?.node.attrs.layout === "fullPage";

  // buttonBlock 의 databaseId — buttonBlock 은 inline atom 이라 hover 는 보통 paragraph.
  // hover 노드 자체와 그 inline 자식에서 buttonBlock 을 찾고, attrs 에 저장된 databaseId 우선,
  // 없으면 href 에서 pageId 추출 후 대상 페이지의 fullPage databaseBlock 조회로 fallback.
  const buttonBlockNode: PMNode | null = (() => {
    if (!hover?.node) return null;
    if (hover.node.type.name === "buttonBlock") return hover.node;
    let found: PMNode | null = null;
    hover.node.descendants((child) => {
      if (found) return false;
      if (child.type.name === "buttonBlock") {
        found = child;
        return false;
      }
      return true;
    });
    return found;
  })();
  const buttonBlockDbId: string | null = (() => {
    if (!buttonBlockNode) return null;
    const stored = buttonBlockNode.attrs.databaseId as string | undefined;
    if (stored) return stored;
    const href = buttonBlockNode.attrs.href as string | undefined;
    if (!href) return null;
    let targetPageId: string | null = null;
    try {
      const url = new URL(href);
      targetPageId = (url.searchParams.get("page") ?? url.pathname.replace(/^\/+/, "")) || null;
    } catch {
      const m = href.match(/[?&]page=([^&]+)/);
      if (m) targetPageId = decodeURIComponent(m[1]!);
    }
    if (!targetPageId) return null;
    const targetPage = usePageStore.getState().pages[targetPageId];
    const first = targetPage?.doc?.content?.[0];
    if (first?.type === "databaseBlock" && first.attrs?.layout === "fullPage") {
      return (first.attrs?.databaseId as string) || null;
    }
    return null;
  })();

  const isDatabaseButtonBlock = !!buttonBlockDbId;
  const isDatabaseInlineBlock = hover?.node.type.name === "databaseBlock" && hover?.node.attrs.layout !== "fullPage";
  const isCallout = hover ? isCalloutBlockNodeType(hover.node.type.name) : false;
  const isColumnLayout = hover?.node.type.name === "columnLayout";
  // 비율 프리셋은 정확히 2컬럼일 때만 노출
  const isTwoColumnLayout = isColumnLayout && hover?.node.childCount === 2;
  const isToggleBlock = hover?.node.type.name === "toggle";
  const isTable = hover?.node.type.name === "table";
  // 표 헤더 상태는 토글 직후 hover.node 가 갱신되기 전일 수 있어 live doc 에서 조회.
  const liveTableNode =
    isTable && hover && editor
      ? (() => {
          const n = editor.state.doc.nodeAt(hover.blockStart);
          return n?.type.name === "table" ? n : hover.node;
        })()
      : null;
  const tableHeaderRowActive = liveTableNode ? isHeaderRowActive(liveTableNode) : false;
  const tableHeaderColActive = liveTableNode ? isHeaderColActive(liveTableNode) : false;
  const isTextBlock = hover
    ? [
        "paragraph",
        "heading",
        "blockquote",
        "toggle",
        "bulletList",
        "orderedList",
        "taskList",
        // 마크다운 형식 블록 — 글머리·번호·체크 항목 개별 단위에도 배경 프리셋 적용
        "listItem",
        "taskItem",
      ].includes(hover.node.type.name)
    : false;
  const isAttachmentBlock =
    hover ? isAttachmentBlockNodeType(hover.node.type.name) : false;
  // 붙여넣기 링크 선택지로 만든 블록(버튼·북마크·유튜브)이면 형식 변환 메뉴를 노출한다.
  const linkBlockHref = hover ? getConvertibleLinkHref(hover.node) : null;
  const shouldShowTypeChange =
    hover != null &&
    !["columnLayout", "column", "tabBlock", "tabPanel", "table", "flowchartBlock"].includes(
      hover.node.type.name,
    );

  return {
    isDatabaseBlock,
    isDatabaseFullPage,
    buttonBlockDbId,
    isDatabaseButtonBlock,
    isDatabaseInlineBlock,
    isCallout,
    isColumnLayout,
    isTwoColumnLayout,
    isToggleBlock,
    isTable,
    tableHeaderRowActive,
    tableHeaderColActive,
    isTextBlock,
    isAttachmentBlock,
    linkBlockHref,
    shouldShowTypeChange,
  };
}
