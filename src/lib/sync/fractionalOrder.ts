// Base-26 fractional indexing.
// 두 키 사이에 새 키를 만들 때 단순 mid string 을 생성한다.
// 단일 사용자 멀티 디바이스 시나리오에서 충돌 없는 정렬 키 보장.

const MIN = "a";
const MAX = "z";
const AFTER_MAX = "{"; // ASCII z 다음 문자. right=null 일 때 끝값 표현용.

export function initialOrder(): string {
  return "m";
}

export function between(left: string | null, right: string | null): string {
  const a = left ?? "";
  const b = right ?? "";
  return midstring(a, b);
}

function charAtOr(s: string, i: number, fallback: string): string {
  return i < s.length ? (s[i] as string) : fallback;
}

function midstring(a: string, b: string): string {
  let i = 0;
  let prefix = "";
  while (true) {
    const ca = charAtOr(a, i, MIN);
    const cb = charAtOr(b, i, b === "" ? AFTER_MAX : MAX);
    if (ca === cb) {
      prefix += ca;
      i++;
      continue;
    }
    const aCode = ca.charCodeAt(0);
    const bCode = cb.charCodeAt(0);
    if (bCode - aCode > 1) {
      const mid = String.fromCharCode(Math.floor((aCode + bCode) / 2));
      return prefix + mid;
    }
    // 인접 문자: a 다음 자리 추가 후 우측에 mid 한 글자.
    prefix += ca;
    i++;
    while (true) {
      const ca2 = charAtOr(a, i, MIN);
      if (ca2.charCodeAt(0) < MAX.charCodeAt(0)) {
        const mid = String.fromCharCode(
          Math.floor((ca2.charCodeAt(0) + MAX.charCodeAt(0) + 1) / 2),
        );
        return prefix + ca2 + mid;
      }
      prefix += ca2;
      i++;
    }
  }
}
