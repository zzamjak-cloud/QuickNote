// TipTap/ProseMirror JSON ↔ QFM(QuickNote-flavored Markdown) 양방향 변환기.
// ⚠ 서버(Lambda) 번들 대상 — 런타임 npm import 금지(타입·상대 경로 import 만 허용).
import type { DocNode } from "../types";
import { parseBlocks, type ParseOptions } from "./blockParser";
import { serializeBlocks } from "./blockSerializer";
import { QfmError } from "./errors";
import { emptyParagraph } from "./lineUtils";

export { QFM_SYNTAX_GUIDE } from "./syntaxGuide";
export { QfmError, type QfmErrorCode } from "./errors";
export { blockRefId, collectBlockRefs } from "./nodeSpecs";
export type { DocNode } from "../types";

export type QfmToDocOptions = ParseOptions;

/** qfmToDoc 입력 상한(UTF-8 바이트) — Lambda 메모리·시간 보호 */
export const QFM_MAX_INPUT_BYTES = 512 * 1024;

function utf8Length(text: string): number {
  // 문자 수가 이미 상한을 넘으면 인코딩 없이 판정
  return text.length > QFM_MAX_INPUT_BYTES ? text.length : new TextEncoder().encode(text).length;
}

/** 문서 JSON → QFM. 일반 블록의 id 는 내보내지 않는다. */
export function docToQfm(doc: DocNode | null | undefined): string {
  if (!doc || typeof doc !== "object") return "";
  const nodes = doc.type === "doc" ? doc.content : [doc];
  const out = serializeBlocks(nodes);
  return out ? `${out}\n` : "";
}

// 코드펜스 밖 줄의 선행 탭을 공백 4칸으로 펼친다(목록 들여쓰기 판정용)
function normalizeLines(md: string): string[] {
  let inFence = false;
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length));
    });
}

/**
 * QFM → 문서 JSON. 결과는 항상 블록 1개 이상(빈 입력이면 빈 문단).
 * @throws QfmError INPUT_TOO_LARGE / UNRESOLVED_BLOCK_REF / DUPLICATE_BLOCK_REF
 */
export function qfmToDoc(md: string, opts?: QfmToDocOptions): DocNode {
  const text = typeof md === "string" ? md : "";
  const bytes = utf8Length(text);
  if (bytes > QFM_MAX_INPUT_BYTES) {
    throw new QfmError("INPUT_TOO_LARGE", `QFM input is ${bytes} bytes (max ${QFM_MAX_INPUT_BYTES})`);
  }
  const content = parseBlocks(normalizeLines(text), opts ?? {});
  return { type: "doc", content: content.length > 0 ? content : [emptyParagraph()] };
}
