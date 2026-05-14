// Editor.tsx 의 순수 헬퍼·상수.
// Editor.tsx 에서 분리 — 동작 변경 없음.

import type { JSONContent } from "@tiptap/react";
import type { ResolvedPos } from "@tiptap/pm/model";
import type { EditorView as PmEditorView } from "@tiptap/pm/view";
import { CellSelection } from "@tiptap/pm/tables";
import { TextSelection } from "@tiptap/pm/state";
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from "@tiptap/pm/transform";
import { useDatabaseStore } from "../../store/databaseStore";
import { getFirstDatabaseBlockId } from "../../lib/blocks/editorPolicy";

export const EMOJI_PICKER_WIDTH = 320;
export const EMOJI_PICKER_HEIGHT = 380;
export const EMOJI_PICKER_GAP = 8;
export const EMOJI_PICKER_MARGIN = 12;
export const PASTE_URL_MENU_WIDTH = 288;
export const PASTE_URL_MENU_HEIGHT = 156;

export const AUTOSAVE_DEBOUNCE_MS = 300;

/** useEditor content 폴백 — 매 렌더 새 객체를 넘기면 옵션 비교 실패 → setOptions 반복 → 무한 업데이트 */
export const EMPTY_EDITOR_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function clampFloatingPanelPosition(
  rect: { top: number; bottom: number; left: number },
  panel: { width: number; height: number } = {
    width: EMOJI_PICKER_WIDTH,
    height: EMOJI_PICKER_HEIGHT,
  },
): { top: number; left: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(
    EMOJI_PICKER_MARGIN,
    viewportWidth - panel.width - EMOJI_PICKER_MARGIN,
  );
  const maxTop = Math.max(
    EMOJI_PICKER_MARGIN,
    viewportHeight - panel.height - EMOJI_PICKER_MARGIN,
  );
  const preferredBelow = rect.bottom + EMOJI_PICKER_GAP;
  const preferredAbove = rect.top - panel.height - EMOJI_PICKER_GAP;
  const hasRoomBelow =
    preferredBelow + panel.height <= viewportHeight - EMOJI_PICKER_MARGIN;
  const top = hasRoomBelow ? preferredBelow : preferredAbove;

  return {
    left: Math.min(Math.max(rect.left, EMOJI_PICKER_MARGIN), maxLeft),
    top: Math.min(Math.max(top, EMOJI_PICKER_MARGIN), maxTop),
  };
}

/** 표 노드 내부 위치인지 */
export function isResolvedPosInTable($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") return true;
  }
  return false;
}

/**
 * 셀 드래그·표 안 텍스트 범위 선택 시 selection-follow 스크롤이
 * 에디터 밖(페이지)까지 전파되는 것을 막는다. (PM scrollToSelection 생략)
 */
export function suppressScrollToSelectionForTableInteraction(
  view: PmEditorView,
): boolean {
  const { selection, doc } = view.state;
  if (selection instanceof CellSelection) return true;
  if (selection instanceof TextSelection && selection.from !== selection.to) {
    return (
      isResolvedPosInTable(doc.resolve(selection.from)) &&
      isResolvedPosInTable(doc.resolve(selection.to))
    );
  }
  return false;
}

/**
 * IME 조합 첫 타자는 ReplaceAroundStep 이거나 마크 단계(Add/RemoveMark) 와 같은 트랜잭션에 섞이는 경우가 있어
 * 기존「ReplaceStep 만」판별 시 UniqueID appendTransaction 이 끼어 조합이 끊긴다.
 */
export function uniqueIdTypingOnlySteps(steps: readonly Step[]): boolean {
  return steps.every(
    (s) =>
      s instanceof ReplaceStep ||
      s instanceof ReplaceAroundStep ||
      s instanceof AddMarkStep ||
      s instanceof RemoveMarkStep,
  );
}

/** Replace 계열 스텝이 넣은 슬라이스 크기 합 — 조합 분할 방지 범위는 160 유지 */
export function uniqueIdTypingInsertedSize(steps: readonly Step[]): number {
  let sum = 0;
  for (const s of steps) {
    if (s instanceof ReplaceStep && s.slice) sum += s.slice.size;
    else if (s instanceof ReplaceAroundStep && s.slice) sum += s.slice.size;
  }
  return sum;
}

/** 슬라이스에 노드 경계(openStart/openEnd > 0)가 있으면 블록 분할/결합 등 구조 변경 — 새 ID 가 필요 */
export function uniqueIdStepsHaveBoundary(steps: readonly Step[]): boolean {
  for (const s of steps) {
    if (s instanceof ReplaceStep || s instanceof ReplaceAroundStep) {
      const slice = s.slice;
      if (slice && (slice.openStart > 0 || slice.openEnd > 0)) return true;
    }
  }
  return false;
}

/** 풀 페이지 DB — 페이지 제목 입력 시 blur 에서만 DB 메타 제목 갱신(중복 검사) */
export function trySyncFullPageDatabaseTitle(
  doc: JSONContent,
  pageTitle: string,
): boolean {
  const databaseId = getFirstDatabaseBlockId(doc);
  if (databaseId) {
    return useDatabaseStore
      .getState()
      .setDatabaseTitle(databaseId, pageTitle);
  }
  return true;
}

/** 본문 스크롤 하단 여백(px) — 뷰포트 높이 42%, 최소 12rem, 최대 680px */
export function computeEditorTailSpacerPx(): number {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const rootRemPx =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  const minPx = Math.round(12 * rootRemPx);
  return Math.min(680, Math.max(minPx, Math.round(vh * 0.42)));
}
