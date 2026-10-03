// 최상위 블록 키 시퀀스 diff — 유지할 (old, new) 인덱스 쌍을 오름차순으로 돌려준다.
// 공통 prefix/suffix 를 먼저 고정하고, 중간 구간은 LCS 로 정렬해 바뀌지 않은 블록의
// Y 아이템을 최대한 보존한다(떨어진 여러 곳 수정 시에도 사이 블록 유지).

/** 중간 구간 LCS 테이블 상한(n*m). 넘으면 중간 구간 전체를 교체로 폴백한다. */
export const MAX_LCS_CELLS = 1_000_000;

export type BlockMatch = readonly [oldIndex: number, newIndex: number];

function lcsMatches(
  oldKeys: readonly string[],
  newKeys: readonly string[],
  oldStart: number,
  newStart: number,
  n: number,
  m: number,
): BlockMatch[] {
  // dp[i*(m+1)+j] = old[i..], new[j..] 의 LCS 길이(뒤에서부터 채움).
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        oldKeys[oldStart + i] === newKeys[newStart + j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const matches: BlockMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldKeys[oldStart + i] === newKeys[newStart + j]) {
      matches.push([oldStart + i, newStart + j]);
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

export function diffBlockKeys(oldKeys: readonly string[], newKeys: readonly string[]): BlockMatch[] {
  const minLen = Math.min(oldKeys.length, newKeys.length);
  let prefix = 0;
  while (prefix < minLen && oldKeys[prefix] === newKeys[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldKeys[oldKeys.length - 1 - suffix] === newKeys[newKeys.length - 1 - suffix]
  ) {
    suffix++;
  }
  const n = oldKeys.length - prefix - suffix;
  const m = newKeys.length - prefix - suffix;
  const middle = n > 0 && m > 0 && n * m <= MAX_LCS_CELLS ? lcsMatches(oldKeys, newKeys, prefix, prefix, n, m) : [];
  const head: BlockMatch[] = Array.from({ length: prefix }, (_, k) => [k, k] as const);
  const tail: BlockMatch[] = Array.from(
    { length: suffix },
    (_, k) => [oldKeys.length - suffix + k, newKeys.length - suffix + k] as const,
  );
  return [...head, ...middle, ...tail];
}
