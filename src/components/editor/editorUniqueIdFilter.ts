import type { Editor as TiptapEditorClass } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  uniqueIdStepsHaveBoundary,
  uniqueIdTypingInsertedSize,
  uniqueIdTypingOnlySteps,
} from "./editorHelpers";

/**
 * UniqueID.configure.filterTransaction 에서 `view.composing` 을 읽기 위한 핸들.
 * onCreate 에서만 설정 — 조합 중 appendTransaction(setNodeMarkup) 이 IME 를 끊는 것을 막는다.
 */
export let uniqueIdFilterHostEditor: TiptapEditorClass | null = null;

export function setUniqueIdFilterHostEditor(editor: TiptapEditorClass | null) {
  uniqueIdFilterHostEditor = editor;
}

/**
 * UniqueID appendTransaction 스킵 여부. false 를 반환하면 스킵(@tiptap/extension-unique-id 규약).
 * useMemo 밖에 둬서 performance.now 정합성·React purity 린트 이슈를 피한다.
 */
export function editorUniqueIdFilterTransaction(tr: Transaction): boolean {
  if (tr.getMeta("composition")) {
    return false;
  }
  if (uniqueIdFilterHostEditor?.view.composing) {
    return false;
  }
  if (!tr.docChanged) return true;
  if (tr.getMeta("__uniqueIDTransaction")) return true;
  if (tr.getMeta("paste")) return true;
  // 블록 분할(Enter) 등 노드 경계가 변하는 트랜잭션은 새 ID 가 필요하므로 처리
  if (uniqueIdStepsHaveBoundary(tr.steps)) return true;
  if (!uniqueIdTypingOnlySteps(tr.steps)) return true;
  const inserted = uniqueIdTypingInsertedSize(tr.steps);
  if (inserted > 160) return true;
  return false;
}
