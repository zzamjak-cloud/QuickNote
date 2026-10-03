// 인라인 파서용 저수준 스캔 헬퍼(강조 닫는 기호·코드 스팬·링크 괄호·태그 짝 탐색).
// 악의적/병적 입력에서 O(n²) 재스캔을 막기 위해 ScanMemo 로 실패 위치와 짝 정보를 캐시한다.
import { isAlnum, isWhitespace } from "./textEscape";

// 링크 목적지 최대 길이 — 닫는 괄호 없는 입력의 장거리 재스캔 방지
const MAX_DESTINATION = 2048;

export type TagPair = { start: number; end: number };

/** 한 번의 parseInline 호출(같은 문자열) 범위에서만 유효한 스캔 캐시. */
export type ScanMemo = {
  // 검색 키 → 실패가 확인된 가장 작은 시작 위치(그 이후 시작도 반드시 실패)
  failed: Map<string, number>;
  brackets: Map<number, number> | null;
  tags: Map<string, Map<number, TagPair>>;
};

export function createScanMemo(): ScanMemo {
  return { failed: new Map(), brackets: null, tags: new Map() };
}

function knownFailure(memo: ScanMemo, key: string, start: number): boolean {
  const f = memo.failed.get(key);
  return f !== undefined && start >= f;
}

function recordFailure(memo: ScanMemo, key: string, start: number): void {
  const f = memo.failed.get(key);
  if (f === undefined || start < f) memo.failed.set(key, start);
}

export function runLength(s: string, i: number, to: number, ch: string): number {
  let n = 0;
  while (i + n < to && s[i + n] === ch) n += 1;
  return n;
}

/** i 위치의 백틱 런과 같은 길이의 닫는 런을 찾는다. */
export function findCodeSpanEnd(
  s: string,
  i: number,
  to: number,
  memo: ScanMemo,
): { text: string; end: number } | null {
  const n = runLength(s, i, to, "`");
  const key = `code:${n}:${to}`;
  if (knownFailure(memo, key, i + n)) return null;
  let p = i + n;
  while (p < to) {
    if (s[p] === "`") {
      const m = runLength(s, p, to, "`");
      if (m === n) {
        // CommonMark: 코드 스팬 내부 줄바꿈은 공백으로 취급
        let text = s.slice(i + n, p).replace(/\n/g, " ");
        if (text.length > 1 && text.startsWith(" ") && text.endsWith(" ") && text.trim()) {
          text = text.slice(1, -1);
        }
        return { text, end: p + n };
      }
      p += m;
    } else {
      p += 1;
    }
  }
  recordFailure(memo, key, i + n);
  return null;
}

/** 이스케이프·코드 스팬을 건너뛰며 ch 런을 찾고 accept 가 돌려준 닫는 위치를 반환. */
function findRun(
  s: string,
  from: number,
  to: number,
  ch: string,
  memo: ScanMemo,
  key: string,
  accept: (start: number, len: number) => number | null,
): number | null {
  // accept 조건은 시작 위치가 뒤일수록 엄격해지므로, 앞에서 실패했으면 뒤에서도 실패
  const memoKey = `${key}:${to}`;
  if (knownFailure(memo, memoKey, from)) return null;
  let p = from;
  while (p < to) {
    const c = s[p];
    if (c === "\\") {
      p += 2;
    } else if (c === "`") {
      const code = findCodeSpanEnd(s, p, to, memo);
      p = code ? code.end : p + runLength(s, p, to, "`");
    } else if (c === ch) {
      const len = runLength(s, p, to, ch);
      const hit = accept(p, len);
      if (hit !== null) return hit;
      p += len;
    } else {
      p += 1;
    }
  }
  recordFailure(memo, memoKey, from);
  return null;
}

export type EmphasisMatch = {
  marks: string[];
  innerFrom: number;
  innerTo: number;
  end: number;
};

/** `**`·`*`·`_`·`__`·`~~` 강조 구간 판정. 실패 시 null(호출부가 리터럴 처리). */
export function matchEmphasis(s: string, i: number, to: number, memo: ScanMemo): EmphasisMatch | null {
  const ch = s[i] ?? "";
  const n = runLength(s, i, to, ch);
  const prev = s[i - 1];
  if (ch === "~") {
    if (n !== 2) return null;
    const close = findRun(s, i + 2, to, "~", memo, "strike", (p, len) =>
      len >= 2 && p > i + 2 ? p + len - 2 : null,
    );
    return close === null ? null : { marks: ["strike"], innerFrom: i + 2, innerTo: close, end: close + 2 };
  }
  if (ch === "_" && isAlnum(prev)) return null;
  const closerOk = (start: number, len: number, width: number): boolean => {
    const closeAt = start + len - width;
    const after = s[start + len];
    if (closeAt <= i + n) return false;
    if (ch === "_" && isAlnum(after)) return false;
    // 단일 기호(이탤릭)는 공백 직후 닫힘을 허용하지 않는다(수식 `a * b` 오인 방지)
    if (width !== 2 && isWhitespace(s[closeAt - 1])) return false;
    return true;
  };
  if (n >= 3) {
    if (isWhitespace(s[i + 3])) return null;
    const close = findRun(s, i + 3, to, ch, memo, `${ch}3`, (p, len) =>
      len >= 3 && closerOk(p, len, 3) ? p + len - 3 : null,
    );
    return close === null ? null : { marks: ["bold", "italic"], innerFrom: i + 3, innerTo: close, end: close + 3 };
  }
  if (n === 2) {
    const close = findRun(s, i + 2, to, ch, memo, `${ch}2`, (p, len) =>
      len >= 2 && closerOk(p, len, 2) ? p + len - 2 : null,
    );
    return close === null ? null : { marks: ["bold"], innerFrom: i + 2, innerTo: close, end: close + 2 };
  }
  if (isWhitespace(s[i + 1])) return null;
  const close = findRun(s, i + 1, to, ch, memo, `${ch}1`, (p, len) => {
    if (len === 2) return null;
    return closerOk(p, len, 1) ? p + len - 1 : null;
  });
  return close === null ? null : { marks: ["italic"], innerFrom: i + 1, innerTo: close, end: close + 1 };
}

/** 문자열 전체의 `[`↔`]` 짝을 한 번에 계산(이스케이프·코드 스팬 제외). */
function bracketPairs(s: string, memo: ScanMemo): Map<number, number> {
  if (memo.brackets) return memo.brackets;
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  let p = 0;
  while (p < s.length) {
    const c = s[p];
    if (c === "\\") {
      p += 2;
      continue;
    }
    if (c === "`") {
      const code = findCodeSpanEnd(s, p, s.length, memo);
      p = code ? code.end : p + runLength(s, p, s.length, "`");
      continue;
    }
    if (c === "[") stack.push(p);
    if (c === "]") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, p);
    }
    p += 1;
  }
  memo.brackets = pairs;
  return pairs;
}

/** 문자열 전체에서 같은 이름 태그의 여는↔닫는 짝을 한 번에 계산. */
export function tagPairs(s: string, tag: string, memo: ScanMemo): Map<number, TagPair> {
  const key = tag.toLowerCase();
  const cached = memo.tags.get(key);
  if (cached) return cached;
  const pairs = new Map<number, TagPair>();
  const stack: number[] = [];
  const re = new RegExp(`<(/?)${key}(?=[\\s>/])[^<>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0].endsWith("/>")) continue;
    if (!m[1]) {
      stack.push(m.index);
      continue;
    }
    const open = stack.pop();
    if (open !== undefined) pairs.set(open, { start: m.index, end: m.index + m[0].length });
  }
  memo.tags.set(key, pairs);
  return pairs;
}

export type LinkMatch = {
  isImage: boolean;
  textFrom: number;
  textTo: number;
  href: string;
  title: string | null;
  end: number;
};

/** `[text](href "title")` / `![alt](src)` 매칭. */
export function matchLink(s: string, i: number, to: number, memo: ScanMemo): LinkMatch | null {
  const isImage = s[i] === "!";
  const open = isImage ? i + 1 : i;
  const close = bracketPairs(s, memo).get(open);
  if (close === undefined || close >= to || s[close + 1] !== "(") return null;
  const dest = matchDestination(s, close + 2, Math.min(to, close + 2 + MAX_DESTINATION));
  return dest ? { isImage, textFrom: open + 1, textTo: close, ...dest } : null;
}

function indexWithin(s: string, ch: string, from: number, to: number): number {
  for (let k = from; k < to; k += 1) if (s[k] === ch) return k;
  return -1;
}

function matchDestination(
  s: string,
  start: number,
  to: number,
): { href: string; title: string | null; end: number } | null {
  let p = start;
  while (p < to && s[p] === " ") p += 1;
  let href = "";
  if (s[p] === "<") {
    const gt = indexWithin(s, ">", p, to);
    if (gt < 0) return null;
    href = s.slice(p + 1, gt);
    p = gt + 1;
  } else {
    let depth = 0;
    while (p < to) {
      const c = s[p] ?? "";
      if (c === "\\" && p + 1 < to) {
        href += s[p + 1] ?? "";
        p += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") depth += 1;
      if (c === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      href += c;
      p += 1;
    }
  }
  while (p < to && s[p] === " ") p += 1;
  const quote = s[p];
  let title: string | null = null;
  if (quote === '"' || quote === "'") {
    const endQuote = indexWithin(s, quote, p + 1, to);
    if (endQuote < 0) return null;
    title = s.slice(p + 1, endQuote);
    p = endQuote + 1;
    while (p < to && s[p] === " ") p += 1;
  }
  return s[p] === ")" && p < to ? { href, title, end: p + 1 } : null;
}
