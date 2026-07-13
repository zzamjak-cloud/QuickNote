// 페이지 "제자리 번역" — 마크다운 왕복(이미지·블럭 소실) 대신 doc 트리를 순회하며
// 텍스트 노드와 이미지/파일 캡션만 번역문으로 치환한다. 블럭 구조·이미지·attrs·marks 는 그대로 유지된다.
import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { getEditorForPage } from "../editor/editorByPageRegistry";
import { streamAiChat } from "./aiClient";

// 번역 대상 한 조각. text=인라인 텍스트 노드, caption=이미지/파일 블럭의 caption attr.
type Target =
  | { kind: "text"; from: number; to: number; text: string; marks: readonly Mark[] }
  | { kind: "caption"; pos: number; text: string };

function posOf(t: Target): number {
  return t.kind === "text" ? t.from : t.pos;
}

// 메시지당 32k자 상한(서버)보다 여유 있게. 입력 배치 하나의 대략적 문자 예산.
// 출력 토큰 상한에 걸려 응답이 잘리면 파싱이 깨지므로 보수적으로 잡는다.
const BATCH_CHAR_BUDGET = 8_000;

/** doc 순회로 번역 대상 수집. codeBlock 내부 텍스트는 코드이므로 제외. */
function collectTargets(editor: Editor): Target[] {
  const targets: Target[] = [];
  editor.state.doc.descendants((node, pos, parent) => {
    // 코드 블럭 내부는 번역하지 않는다(자식 순회도 중단).
    if (node.type.name === "codeBlock") return false;
    if (node.isText) {
      const text = node.text ?? "";
      // 부모가 코드블럭이면 스킵(위 return false 로 대부분 차단되지만 방어적으로 한 번 더).
      if (parent?.type.name === "codeBlock") return false;
      if (text.trim()) {
        targets.push({ kind: "text", from: pos, to: pos + node.nodeSize, text, marks: node.marks });
      }
      return false;
    }
    // 이미지·파일 블럭 캡션(별도 attr — 텍스트 노드가 아니라 setNodeMarkup 으로 갱신).
    if (node.type.name === "image" || node.type.name === "fileBlock") {
      const cap = node.attrs.caption;
      if (typeof cap === "string" && cap.trim()) {
        targets.push({ kind: "caption", pos, text: cap });
      }
    }
    return true;
  });
  return targets;
}

/** 문자 예산 기준으로 대상을 배치로 나눈다(각 배치를 한 번의 AI 요청으로 번역). */
function chunkTargets(targets: Target[]): Target[][] {
  const batches: Target[][] = [];
  let cur: Target[] = [];
  let curChars = 0;
  for (const t of targets) {
    const len = t.text.length + 8; // JSON 오버헤드 여유
    if (cur.length > 0 && curChars + len > BATCH_CHAR_BUDGET) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(t);
    curChars += len;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

// 줄 단위 번호 마커 프로토콜 — 엄격한 JSON 배열보다 견고하다.
// 텍스트 노드/캡션 문자열은 (코드블럭 제외 시) 개행을 포함하지 않으므로 한 줄 = 한 조각이 성립한다.
// 입력:  「0」원문  / 출력: 「0」번역문  (번호로 매핑, 누락분은 원문 유지 → 부분 성공 허용)
const MARK_OPEN = "「"; // 「
const MARK_CLOSE = "」"; // 」

function buildMarkedInput(texts: string[]): string {
  // 원문에 개행이 있어도 한 줄로 눌러(공백화) 프로토콜을 안정화한다.
  return texts
    .map((t, i) => `${MARK_OPEN}${i}${MARK_CLOSE}${t.replace(/[\r\n]+/g, " ")}`)
    .join("\n");
}

/** AI 응답에서 「n」번역문 줄들을 파싱해 인덱스→번역 맵을 만든다. */
function parseMarkedOutput(raw: string): Map<number, string> {
  // 모델이 실수로 붙이는 코드펜스 제거(``` 또는 ```lang).
  const cleaned = raw.replace(/```[a-zA-Z]*\n?/g, "");
  const map = new Map<number, string>();
  const re = /「(\d+)」([\s\S]*?)(?=「\d+」|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const idx = Number(m[1]);
    if (Number.isInteger(idx)) map.set(idx, m[2]!.replace(/^[ \t]+|[ \t\r\n]+$/g, ""));
  }
  return map;
}

async function translateBatch(
  texts: string[],
  args: {
    workspaceId: string;
    pageId: string;
    model: string | null;
    targetLanguage: string;
    signal?: AbortSignal;
  },
): Promise<string[] | null> {
  let acc = "";
  await streamAiChat({
    workspaceId: args.workspaceId,
    pageId: args.pageId,
    action: "translateSegments",
    options: { targetLanguage: args.targetLanguage },
    model: args.model,
    messages: [{ role: "user", content: buildMarkedInput(texts) }],
    signal: args.signal,
    onDelta: (t) => {
      acc += t;
    },
  });
  const map = parseMarkedOutput(acc);
  // 마커가 하나도 안 잡히면 완전 실패로 본다(문서 훼손 방지).
  if (map.size === 0) return null;
  // 번호로 매핑, 누락된 조각은 원문 유지(부분 성공). 길이는 항상 입력과 동일.
  return texts.map((orig, i) => {
    const t = map.get(i);
    return typeof t === "string" && t !== "" ? t : orig;
  });
}

/** 번역 결과를 한 트랜잭션으로 제자리 반영. 위치가 높은 것부터 적용해 앞선 위치를 유효하게 유지. */
function applyTranslations(editor: Editor, targets: Target[], translations: string[]): number {
  const items = targets
    .map((t, i) => ({ t, next: translations[i] }))
    .filter((x) => typeof x.next === "string" && x.next !== "" && x.next !== x.t.text)
    .sort((a, b) => posOf(b.t) - posOf(a.t));
  if (items.length === 0) return 0;

  const tr = editor.state.tr;
  let applied = 0;
  for (const { t, next } of items) {
    if (t.kind === "text") {
      tr.replaceWith(t.from, t.to, editor.schema.text(next!, t.marks as Mark[]));
    } else {
      const node = tr.doc.nodeAt(t.pos);
      if (!node) continue;
      tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, caption: next });
    }
    applied += 1;
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return applied;
}

export type TranslatePageResult =
  | { ok: true; applied: number; total: number; failedSegments: number }
  | { ok: false; reason: "no-editor" | "not-editable" | "empty" | "failed" | "aborted" };

/**
 * 페이지 본문을 구조 보존하며 제자리 번역한다.
 * 텍스트 노드 + 이미지/파일 캡션만 번역, 블럭 구조·이미지·서식은 유지.
 */
export async function translatePageInPlace(args: {
  pageId: string;
  workspaceId: string;
  model: string | null;
  targetLanguage: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<TranslatePageResult> {
  const editor = getEditorForPage(args.pageId);
  if (!editor) return { ok: false, reason: "no-editor" };
  if (!editor.isEditable) return { ok: false, reason: "not-editable" };

  // 대상 수집은 번역 시작 시점의 doc 스냅샷 기준(위치 좌표 유효성).
  const targets = collectTargets(editor);
  if (targets.length === 0) return { ok: false, reason: "empty" };

  // 전체를 여러 배치로 쪼개 각각 독립적으로 번역·병합한다. 한 배치가 실패해도
  // 나머지는 그대로 반영하고(부분 성공), 실패 배치는 1회 재시도 후 원문을 유지한다.
  const batches = chunkTargets(targets);
  const translations: string[] = [];
  let done = 0;
  let failedSegments = 0;
  const batchArgs = {
    workspaceId: args.workspaceId,
    pageId: args.pageId,
    model: args.model,
    targetLanguage: args.targetLanguage,
    signal: args.signal,
  };
  try {
    for (const batch of batches) {
      const texts = batch.map((t) => t.text);
      let out = await translateBatch(texts, batchArgs);
      if (!out) out = await translateBatch(texts, batchArgs); // 1회 재시도
      if (!out) {
        // 이 배치는 실패 — 원문 유지하고 계속(통째 실패 방지).
        translations.push(...texts);
        failedSegments += batch.length;
      } else {
        translations.push(...out);
      }
      done += batch.length;
      args.onProgress?.(done, targets.length);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { ok: false, reason: "aborted" };
    throw e;
  }

  // 모든 배치가 실패했으면 번역 결과가 전부 원문 → 실패로 보고.
  if (failedSegments >= targets.length) return { ok: false, reason: "failed" };

  // 번역 도중 문서가 바뀌었을 수 있으므로, 적용 직전 최신 에디터를 다시 조회한다.
  const liveEditor = getEditorForPage(args.pageId);
  if (!liveEditor || !liveEditor.isEditable) return { ok: false, reason: "no-editor" };
  const applied = applyTranslations(liveEditor, targets, translations);
  return { ok: true, applied, total: targets.length, failedSegments };
}
