// QFM 텍스트·태그 속성 이스케이프 유틸. 런타임 npm import 금지(Lambda 번들).

const ALNUM = /[\p{L}\p{N}]/u;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

export function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && ALNUM.test(ch);
}

export function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

export function isAsciiPunct(ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && ASCII_PUNCT.test(ch);
}

/** 일반 텍스트를 QFM 인라인으로 이스케이프 — 파서가 마크/태그로 오인하지 않게 한다. */
export function escapeText(text: string, inTable = false): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    const prev = text[i - 1];
    const next = text[i + 1];
    if (ch === "\\" || ch === "*" || ch === "`" || ch === "[" || ch === "]") {
      out += `\\${ch}`;
    } else if (ch === "_") {
      // 단어 내부 밑줄(snake_case)은 강조로 해석되지 않으므로 그대로 둔다
      out += isAlnum(prev) && isAlnum(next) ? "_" : "\\_";
    } else if (ch === "~") {
      out += prev === "~" || next === "~" ? "\\~" : "~";
    } else if (ch === "<") {
      out += next !== undefined && /[A-Za-z/!?]/.test(next) ? "\\<" : "<";
    } else if (ch === "|" && inTable) {
      out += "\\|";
    } else {
      out += ch;
    }
  }
  return out;
}

/** 줄 시작이 블록 문법(#, -, 1. 등)으로 해석되지 않도록 첫 기호를 이스케이프한다. */
export function escapeLineStart(line: string): string {
  const lead = line.match(/^\s*/)?.[0] ?? "";
  const body = line.slice(lead.length);
  const ordered = body.match(/^(\d{1,9})([.)])(\s|$)/);
  if (ordered) {
    const digits = ordered[1] ?? "";
    return `${lead}${digits}\\${body.slice(digits.length)}`;
  }
  if (/^[#>+\-|]/.test(body)) return `${lead}\\${body}`;
  return line;
}

/** 블록 문법 오인을 막기 위해 여러 줄 문자열의 각 줄 시작을 이스케이프한다. */
export function escapeLinesStart(text: string): string {
  return text.split("\n").map(escapeLineStart).join("\n");
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");
}

export function decodeAttr(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|amp|quot|lt|gt|apos);/gi, (_m, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/** `a="1" b='2' c` 형태 태그 속성 문자열 → 레코드(값 없는 속성은 ""). */
export function parseTagAttrs(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw) return attrs;
  const re = /([A-Za-z_][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1] ?? "";
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = decodeAttr(value);
  }
  return attrs;
}

/** 레코드 → ` a="1" b="2"` (undefined 는 생략). */
export function formatTagAttrs(attrs: Array<[string, string | undefined]>): string {
  return attrs
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
}

/** 태그 내부 라벨 텍스트용 — 백슬래시·`<` 만 이스케이프. */
export function escapeLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/</g, "\\<");
}

/** 백슬래시 이스케이프 해제(라벨 텍스트용). */
export function unescapeBackslashes(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

const DANGEROUS_URL = /^\s*(javascript|vbscript|data):/i;

/** XSS 위험 스킴(javascript:/vbscript:/data:) 판정. */
export function isDangerousUrl(url: string): boolean {
  // 브라우저는 스킴 안의 제어문자·공백을 무시하므로 제거 후 판정
  const compact = Array.from(url)
    .filter((c) => c.charCodeAt(0) > 0x20)
    .join("");
  return DANGEROUS_URL.test(compact);
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR =
  /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(?:,\s*(?:\d?\.\d+|[01]|\d{1,3}%)\s*)?\)$/i;
// CSS 영문 색 이름 및 앱 색 토큰(blue, darkGray, default 등)
const NAMED_COLOR = /^[a-z]{3,24}$/i;

/** 허용 색 형식: #hex(3/6/8), rgb()/rgba(), 영문 이름·앱 토큰. 그 외(CSS 주입 등)는 거부. */
export function isSafeColor(value: string): boolean {
  const v = value.trim();
  return HEX_COLOR.test(v) || RGB_COLOR.test(v) || NAMED_COLOR.test(v);
}
