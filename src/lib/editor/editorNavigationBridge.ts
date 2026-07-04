import type { Editor } from "@tiptap/core";
import { koreanMatchOffset } from "../koreanSearch";
import { markProgrammaticScroll, suppressScrollRestoreFor } from "../navigation/pageScrollMemory";

/** 활성 에디터가 현재 어떤 페이지의 본문을 들고 있는지(pageContext storage 기준). */
function activeEditorPageId(): string | null {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return null;
  const ctx = editor.storage.pageContext as { pageId?: string | null } | undefined;
  return ctx?.pageId ?? null;
}

/** 검색 결과 이동 대상 — 라이브 텍스트(query) 우선, 실패 시 blockId/blockIndex 폴백 */
export type SearchHitTarget = {
  query?: string;
  blockId: string | null;
  blockIndex: number;
};

/** 블록 링크/딥링크 이동 대상 — blockId(편집에도 안전) 우선, 없으면 숫자 위치 폴백. */
export type BlockLinkTarget = {
  blockId?: string | null;
  blockPos?: number | null;
  /**
   * blockId/숫자 위치로 못 찾을 때 마지막 폴백으로 쓸 라벨 텍스트(소문자 무관).
   * 협업 ON 환경에서 서버 시드 본문이 구버전이라 heading 의 attrs.id 가 어긋난 경우
   * 링크 표시 텍스트(제목)로라도 이동시켜 무반응을 막는다. blockId 성공 시엔 쓰이지 않음.
   */
  fallbackText?: string | null;
};

/** 우측 패널(목차·댓글)에서 메인 에디터로 스크롤/포커스 요청할 때 쓰는 단일 브리지 */
let activeEditor: Editor | null = null;

/** 메인 Editor 마운트 시 등록, 언마운트 시 해제 */
export function registerEditorNavigation(editor: Editor | null): void {
  activeEditor = editor;
}

export function unregisterEditorNavigation(editor: Editor): void {
  if (activeEditor === editor) activeEditor = null;
}

/** 문서에서 레벨 1~maxLevel 헤딩의 시작 위치만 순서대로 수집 */
function collectHeadingPositions(maxLevel: number): number[] {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return [];
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level as number;
    if (level >= 1 && level <= maxLevel) positions.push(pos);
  });
  return positions;
}

/**
 * 목차 JSON 추출 순서와 동일하게, N번째(0-based) 헤딩(레벨 1~4)으로 이동
 */
export function scrollToOutlineHeadingIndex(index: number): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return false;
  const positions = collectHeadingPositions(4);
  const startPos = positions[index];
  if (startPos === undefined) return false;

  // PM 의 .scrollIntoView() 는 handleScrollToSelection 이 전면 true 를 반환해 무력화되므로
  // (선택만 되고 뷰포트가 안 움직임) 댓글·검색과 동일하게 DOM 을 직접 스크롤하는 경로를 쓴다.
  return scrollToBlockPosition(startPos);
}

/** 주어진 에디터의 doc 에서 attrs.id 가 blockId 인 블록의 시작 pos. */
function findBlockPositionByIdIn(editor: Editor, blockId: string): number | null {
  let foundPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (foundPos !== null) return false;
    if ((node.attrs.id as string | undefined) === blockId) {
      foundPos = pos;
      return false;
    }
    return true;
  });
  return foundPos;
}

/** 블록 노드 attrs.id 로 pos 조회(UniqueID). */
export function findBlockPositionById(blockId: string): number | null {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return null;
  return findBlockPositionByIdIn(editor, blockId);
}

/** 블록 노드 attrs.id 로 스크롤(댓글 카드 등). */
export function scrollToBlockId(blockId: string): boolean {
  const foundPos = findBlockPositionById(blockId);
  if (foundPos === null) return false;
  return scrollToBlockPosition(foundPos);
}

/** doc 범위 안의 유효한 pos 면 그대로, 아니면 null. */
function clampValidPos(editor: Editor, pos: number | null | undefined): number | null {
  if (pos == null) return null;
  return pos >= 0 && pos <= editor.state.doc.content.size ? pos : null;
}

/** blockId(우선) 또는 숫자 폴백으로 현재 doc 에서의 블록 pos 를 구한다. */
function resolveTargetPos(
  editor: Editor,
  blockId: string | null,
  fallbackPos: number | null,
): number | null {
  if (blockId) {
    const byId = findBlockPositionByIdIn(editor, blockId);
    if (byId !== null) return byId;
  }
  return clampValidPos(editor, fallbackPos);
}

/** 대상 pos 에 선택(+포커스)을 설정한다. 원자 노드면 NodeSelection, 아니면 caret. */
function selectBlockAtPos(editor: Editor, blockPos: number): boolean {
  const doc = editor.state.doc;
  if (blockPos < 0 || blockPos > doc.content.size) return false;
  const nodeAfter = doc.resolve(blockPos).nodeAfter;
  if (nodeAfter?.isAtom && nodeAfter.isLeaf) {
    try {
      editor.chain().focus().setNodeSelection(blockPos).run();
      return true;
    } catch {
      /* fall through */
    }
  }
  const caret = Math.min(blockPos + 1, doc.content.size);
  try {
    editor.chain().focus().setTextSelection(caret).run();
    return true;
  } catch {
    return false;
  }
}

/**
 * 블록 시작 pos 로 이동(댓글·검색 등 숫자 위치 기반 호출용).
 * 선택만 설정하고 실제 뷰포트 이동은 scrollBlockDomIntoView 가 담당한다.
 */
export function scrollToBlockPosition(
  blockPos: number,
  targetPageId: string | null = null,
  opts: { flash?: boolean } = {},
): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return false;
  if (blockPos < 0 || blockPos > editor.state.doc.content.size) return false;

  // 페이지 전환 직후 스크롤 위치 복원(restorePageScrollPosition)이 이 스크롤을
  // 즉시 맨 위로 되돌리지 못하도록, 프로그래밍적 스크롤임을 알려 복원 루프를 종료시킨다.
  markProgrammaticScroll();

  // PM 의 .scrollIntoView() 는 에디터가 handleScrollToSelection 에서 전면 true 를 반환해
  // (타이핑 중 자동 스크롤·복원 보호 목적) 무력화되므로 쓰지 않는다. 선택만 설정하고
  // 실제 뷰포트 이동은 scrollBlockDomIntoView 로 DOM 을 직접 스크롤해 처리한다.
  if (!selectBlockAtPos(editor, blockPos)) return false;
  scrollBlockDomIntoView(null, blockPos, targetPageId, opts.flash ?? false);
  return true;
}

/**
 * 주어진 요소를 실제로 스크롤하는 가장 가까운 조상을 찾는다.
 * .qn-editor-body-scroll 이라도 콘텐츠가 넘치지 않으면(clientHeight=scrollHeight) 스크롤되지 않으므로,
 * overflow 가 auto/scroll/overlay 이면서 실제로 넘치는 조상만 채택한다. 없으면 문서 스크롤러로 폴백.
 */
function getScrollParent(node: HTMLElement): HTMLElement {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** 문서 전체를 스크롤하는 루트 요소인지(좌표 공식 분기용). */
function isDocumentScroller(el: HTMLElement): boolean {
  return (
    el === document.scrollingElement ||
    el === document.documentElement ||
    el === document.body
  );
}

/** 대상 블록 pos 의 DOM 요소를 찾는다(원자 노드면 nodeDOM, 텍스트면 domAtPos 의 근접 요소). */
function resolveBlockElement(editor: Editor, blockPos: number): HTMLElement | null {
  let dom: Node | null = null;
  try {
    dom = editor.view.nodeDOM(blockPos);
  } catch {
    dom = null;
  }
  if (dom instanceof HTMLElement) return dom;
  try {
    const caret = Math.min(blockPos + 1, editor.state.doc.content.size);
    const at = editor.view.domAtPos(caret);
    if (at.node instanceof HTMLElement) return at.node;
    if (at.node.parentElement) return at.node.parentElement;
  } catch {
    /* noop */
  }
  return null;
}

/**
 * PM 의 scrollIntoView 가 handleScrollToSelection 전면 차단으로 무력화되어 있으므로,
 * 대상 블록 DOM 을 스크롤 컨테이너 기준으로 직접 가져온다.
 *
 * 단발성으로 끝내지 않고 내비게이션 윈도(MAX_MS) 동안 "현재 활성 에디터" 기준으로 재보정한다.
 * 페이지 전환 직후 원격 데이터가 도착하면 에디터가 재생성(remount)되며 스크롤러가 0 으로
 * 초기화되는데, 이때 위치가 어긋나면 다시 블록으로 맞춘다. 매 프레임 blockId 로 pos 를 다시
 * 풀어(remount 로 doc 이 갱신돼 숫자 위치가 밀려도 정확) 보정하며, markProgrammaticScroll +
 * suppressScrollRestoreFor 로 스크롤 위치 복원과의 경합도 차단한다.
 *
 * 종료 조건: 보정이 필요 없는(=이미 제자리) 프레임이 STABLE_FRAMES 연속이면 안정으로 보고
 * 종료(보통 수백 ms). 그 외에는 MAX_MS 초과 시 종료.
 */
function scrollBlockDomIntoView(
  blockId: string | null,
  fallbackPos: number | null,
  targetPageId: string | null,
  flash: boolean = false,
): void {
  const TOP_OFFSET_PX = 96; // 상단 여백(고정 헤더 등 가림 방지)
  const MAX_MS = 3000; // 에디터 재생성·원격 하이드레이션이 끝날 때까지 재보정
  const STABLE_FRAMES = 8; // 보정 불필요 프레임이 연속 이만큼이면 종료(약 130ms)
  const startedAt = window.performance.now();
  let okStreak = 0;
  // 이동 위치 시각화는 body 포털 오버레이가 책임진다(PM DOM 밖이라 재조정/재생성에 지워지지 않음).
  if (flash) spotlightBlock(blockId, fallbackPos, targetPageId);

  // 스크롤러는 한 번 찾으면 캐시하되, 분리(remount)되면 다시 찾는다(매 프레임 getComputedStyle 비용 절감).
  let cachedHost: HTMLElement | null = null;
  const hostFor = (el: HTMLElement): HTMLElement => {
    if (cachedHost && cachedHost.isConnected) return cachedHost;
    cachedHost = getScrollParent(el);
    return cachedHost;
  };

  const apply = (): void => {
    const elapsed = window.performance.now() - startedAt;
    const cont = (): void => {
      if (elapsed < MAX_MS) window.requestAnimationFrame(apply);
    };
    const editor = activeEditor;
    if (!editor || editor.isDestroyed) {
      cont();
      return;
    }
    // 대상 페이지가 지정됐는데 활성 에디터가 아직 그 페이지가 아니면(재생성 중) 대기.
    if (targetPageId && activeEditorPageId() !== targetPageId) {
      cont();
      return;
    }
    const pos = resolveTargetPos(editor, blockId, fallbackPos);
    if (pos === null) {
      cont();
      return;
    }
    const el = resolveBlockElement(editor, pos);
    if (!el) {
      cont();
      return;
    }
    const host = hostFor(el);
    const docScroller = isDocumentScroller(host);
    const elRect = el.getBoundingClientRect();
    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
    const before = host.scrollTop;
    // 문서 스크롤러: elRect.top 은 이미 뷰포트 기준 → before + elRect.top.
    // 일반 요소 스크롤러: 호스트 뷰포트 오프셋을 빼서 호스트 내부 좌표로 환산.
    const elTopRel = docScroller ? elRect.top : elRect.top - host.getBoundingClientRect().top;
    const target = Math.min(Math.max(0, before + elTopRel - TOP_OFFSET_PX), maxTop);
    const atOffset = Math.abs(elTopRel - TOP_OFFSET_PX) <= 6;
    const atBottom = maxTop > 0 && before >= maxTop - 1; // 하단 블록은 OFFSET 까지 못 올 수 있음
    const onTarget = Math.abs(before - target) <= 2 && (atOffset || atBottom);
    if (!onTarget) {
      markProgrammaticScroll();
      suppressScrollRestoreFor(host);
      host.scrollTop = target;
      okStreak = 0;
    } else {
      okStreak += 1;
    }
    if (okStreak >= STABLE_FRAMES) return; // 안정 → 종료
    cont();
  };
  // 첫 적용은 다음 프레임에(선택/포커스로 인한 레이아웃 반영 후) 시작.
  window.requestAnimationFrame(apply);
}

/**
 * 블록 링크/딥링크 이동 — 대상 페이지의 에디터가 준비될 때까지 짧게 재시도한 뒤 스크롤한다.
 * 페이지 전환 직후엔 메인 에디터가 아직 이전 페이지의 doc 을 들고 있을 수 있으므로,
 * pageContext.pageId 가 대상 페이지와 일치할 때까지 기다렸다가 스크롤한다(불일치 시 엉뚱한 위치 방지).
 * pageId 가 없으면(레거시) 게이팅 없이 활성 에디터 기준으로 바로 시도한다.
 * 대상은 blockId 우선(편집에도 안전), 없으면 숫자 위치 폴백.
 */
export function navigateToBlockLink(
  pageId: string | null,
  target: BlockLinkTarget,
  opts: { maxTries?: number; intervalMs?: number } = {},
): void {
  const blockId = target.blockId ?? null;
  const fallbackPos = target.blockPos ?? null;
  const fallbackText = (target.fallbackText ?? "").trim().toLowerCase();
  if (blockId == null && fallbackPos == null && !fallbackText) return;
  const maxTries = opts.maxTries ?? 50;
  const intervalMs = opts.intervalMs ?? 100;
  let tries = 0;
  const tick = (): void => {
    tries += 1;
    const pageReady = pageId == null || activeEditorPageId() === pageId;
    if (pageReady) {
      const editor = activeEditor;
      if (editor && !editor.isDestroyed) {
        const pos = resolveTargetPos(editor, blockId, fallbackPos);
        if (pos !== null) {
          markProgrammaticScroll();
          selectBlockAtPos(editor, pos);
          // 하이라이트는 scrollBlockDomIntoView 루프가 (재생성 후에도) 책임지고 적용한다.
          scrollBlockDomIntoView(blockId, fallbackPos, pageId, true);
          return;
        }
        // blockId/숫자 위치로 못 찾았고 라벨 텍스트가 있으면 텍스트 매칭으로 폴백한다.
        // (협업 시드 본문이 구버전이라 attrs.id 가 어긋난 경우의 안전망 — blockId 성공 시엔 미실행.)
        if (fallbackText && scrollToTextMatch(fallbackText)) return;
      }
    }
    if (tries < maxTries) window.setTimeout(tick, intervalMs);
  };
  tick();
}

/** N번째(0-based) top-level 블록의 시작 pos. blockId 가 없는 블록 이동의 폴백. */
export function findTopLevelBlockPosition(index: number): number | null {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return null;
  const doc = editor.state.doc;
  if (index < 0 || index >= doc.childCount) return null;
  let offset = 0;
  for (let i = 0; i < index; i++) offset += doc.child(i).nodeSize;
  return offset;
}

/**
 * 이동 위치 시각화 — 대상 블록 위에 떠 있는 오버레이 박스(body 포털)를 그린다.
 *
 * PM 노드 DOM 에 직접 class 를 붙이는 방식은 하이드레이션/재조정/에디터 재생성 때 PM 이 toDOM 으로
 * 노드를 다시 그리며 class 를 지워버려 하이라이트가 사라졌다. 오버레이는 PM DOM 바깥(document.body)에
 * 있으므로 PM 이 본문을 아무리 다시 그려도 영향받지 않는다.
 *
 * position:fixed + getBoundingClientRect 로 매 프레임 대상 블록의 뷰포트 위치를 추적하므로,
 * 스크롤 보정·콘텐츠 하이드레이션·에디터 재생성으로 블록이 움직여도 정확히 따라붙는다.
 * blockId(우선)로 pos 를 매 프레임 다시 풀어 재생성 후 새 DOM 에도 정확히 정렬한다.
 */
function spotlightBlock(
  blockId: string | null,
  fallbackPos: number | null,
  targetPageId: string | null,
): void {
  if (typeof document === "undefined") return;
  const HOLD_MS = 1600; // 오버레이가 대상에 안착한 뒤 표시 유지 시간(CSS 애니메이션과 일치)
  const MAX_MS = 4000; // 페이지/에디터 준비 대기 포함 최대 수명
  const PAD = 4; // 블록을 살짝 감싸는 여백
  const startedAt = window.performance.now();
  let overlay: HTMLDivElement | null = null;
  let anchoredAt = 0;
  const cleanup = (): void => {
    overlay?.remove();
    overlay = null;
  };
  const tick = (): void => {
    const now = window.performance.now();
    const editor = activeEditor;
    let el: HTMLElement | null = null;
    if (
      editor &&
      !editor.isDestroyed &&
      (!targetPageId || activeEditorPageId() === targetPageId)
    ) {
      const pos = resolveTargetPos(editor, blockId, fallbackPos);
      el = pos !== null ? resolveBlockElement(editor, pos) : null;
    }
    if (el) {
      const r = el.getBoundingClientRect();
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "qn-block-spotlight";
        document.body.appendChild(overlay);
        anchoredAt = now; // 오버레이가 처음 뜬 시점부터 유지 시간 측정
      }
      overlay.style.top = `${Math.round(r.top - PAD)}px`;
      overlay.style.left = `${Math.round(r.left - PAD)}px`;
      overlay.style.width = `${Math.round(r.width + PAD * 2)}px`;
      overlay.style.height = `${Math.round(r.height + PAD * 2)}px`;
    }
    if (overlay && now - anchoredAt >= HOLD_MS) {
      cleanup();
      return;
    }
    if (now - startedAt < MAX_MS) {
      window.requestAnimationFrame(tick);
    } else {
      cleanup();
    }
  };
  window.requestAnimationFrame(tick);
}

/**
 * 활성 에디터의 라이브 문서에서 query(소문자)를 포함하는 첫 번째 텍스트블록을 찾아 이동한다.
 * - node.textContent 로 비교하므로 마크(볼드 등)로 분할된 텍스트도 매칭된다.
 * - 컬럼/표/리스트 등 중첩 깊이와 무관하게 descendants 로 정확히 짚는다.
 * - 접힌 toggle / 비활성 tab 조상은 먼저 펼친 뒤 다음 프레임에 스크롤한다.
 * - 이동 자체는 블록 링크와 동일한 scrollToBlockPosition 을 사용한다.
 * 본문에 query 가 아직 없으면(페이지 전환 직후 미하이드레이션) false → 호출측 재시도로 자체 게이팅.
 */
export function scrollToTextMatch(queryLower: string): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed || !queryLower) return false;
  const { doc } = editor.state;

  let blockPos: number | null = null;
  doc.descendants((node, pos) => {
    if (blockPos !== null) return false;
    if (node.isTextblock && node.textContent) {
      if (koreanMatchOffset(node.textContent.toLowerCase(), queryLower) >= 0) {
        blockPos = pos;
        return false;
      }
    }
    return true;
  });
  if (blockPos === null) return false;
  const target: number = blockPos;

  // 숨겨지는 컨테이너 조상을 따라가며 대상이 보이도록 펼친다(한 트랜잭션으로 일괄).
  // - toggle: open=false 면 open=true.
  // - tabBlock: 대상이 속한 tabPanel 이 비활성이면 activeIndex 를 그 패널로 변경.
  // 컬럼/표/리스트 등 항상 렌더되는 중첩은 별도 처리 불필요(descendants 로 이미 정확히 짚음).
  const $pos = doc.resolve(target);
  let tr = editor.state.tr;
  let expanded = false;
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    const nodePos = $pos.before(depth);
    if (node.type.name === "toggle" && node.attrs.open === false) {
      tr = tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, open: true });
      expanded = true;
    } else if (node.type.name === "tabBlock") {
      const panelIndex = $pos.index(depth); // 대상이 속한 패널(자식) 인덱스
      if (Number(node.attrs.activeIndex ?? 0) !== panelIndex) {
        tr = tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, activeIndex: panelIndex });
        expanded = true;
      }
    }
  }
  if (expanded) {
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }

  const apply = () => {
    if (editor.isDestroyed) return;
    // 블록 링크와 동일 경로 + 하이라이트(루프가 재생성 후에도 재적용).
    scrollToBlockPosition(target, null, { flash: true });
  };
  // 펼친 경우 NodeView 재렌더로 좌표가 생긴 뒤 스크롤
  if (expanded) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(apply));
  } else {
    apply();
  }
  return true;
}

/**
 * 검색 결과 이동 — query 로 라이브 문서를 검색(자체 게이팅: 본문 로드 전엔 false)해 이동한다.
 * query 가 없을 때만 blockId 로 폴백(고유 id 라 오답 위험 없음).
 * 위험한 blockIndex 폴백은 제거 — 전환 직후 빈/이전 문서에서 엉뚱한 위치로 조기 성공하는 버그를 막는다.
 */
export function scrollToSearchHit(target: SearchHitTarget): boolean {
  if (target.query && scrollToTextMatch(target.query)) return true;
  if (target.blockId) {
    const pos = findBlockPositionById(target.blockId);
    if (pos !== null) {
      return scrollToBlockPosition(pos, null, { flash: true });
    }
  }
  return false;
}
