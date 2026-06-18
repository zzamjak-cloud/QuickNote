const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const ENG_TO_JAMO: Record<string, string> = {
  r: 'ㄱ', R: 'ㄲ', s: 'ㄴ', e: 'ㄷ', E: 'ㄸ', f: 'ㄹ', a: 'ㅁ', q: 'ㅂ', Q: 'ㅃ',
  t: 'ㅅ', T: 'ㅆ', d: 'ㅇ', w: 'ㅈ', W: 'ㅉ', c: 'ㅊ', z: 'ㅋ', x: 'ㅌ', v: 'ㅍ', g: 'ㅎ',
  k: 'ㅏ', o: 'ㅐ', i: 'ㅑ', O: 'ㅒ', j: 'ㅓ', p: 'ㅔ', u: 'ㅕ', P: 'ㅖ', h: 'ㅗ',
  y: 'ㅛ', n: 'ㅜ', b: 'ㅠ', m: 'ㅡ', l: 'ㅣ',
};
const CHOSEONG_INDEX: Record<string, number> = {
  'ㄱ': 0, 'ㄲ': 1, 'ㄴ': 2, 'ㄷ': 3, 'ㄸ': 4, 'ㄹ': 5, 'ㅁ': 6, 'ㅂ': 7, 'ㅃ': 8,
  'ㅅ': 9, 'ㅆ': 10, 'ㅇ': 11, 'ㅈ': 12, 'ㅉ': 13, 'ㅊ': 14, 'ㅋ': 15, 'ㅌ': 16, 'ㅍ': 17, 'ㅎ': 18,
};
const JUNGSEONG_INDEX: Record<string, number> = {
  'ㅏ': 0, 'ㅐ': 1, 'ㅑ': 2, 'ㅒ': 3, 'ㅓ': 4, 'ㅔ': 5, 'ㅕ': 6, 'ㅖ': 7, 'ㅗ': 8,
  'ㅘ': 9, 'ㅙ': 10, 'ㅚ': 11, 'ㅛ': 12, 'ㅜ': 13, 'ㅝ': 14, 'ㅞ': 15, 'ㅟ': 16, 'ㅠ': 17, 'ㅡ': 18, 'ㅢ': 19, 'ㅣ': 20,
};
const JONGSEONG_INDEX: Record<string, number> = {
  '': 0, 'ㄱ': 1, 'ㄲ': 2, 'ㄳ': 3, 'ㄴ': 4, 'ㄵ': 5, 'ㄶ': 6, 'ㄷ': 7, 'ㄹ': 8, 'ㄺ': 9, 'ㄻ': 10,
  'ㄼ': 11, 'ㄽ': 12, 'ㄾ': 13, 'ㄿ': 14, 'ㅀ': 15, 'ㅁ': 16, 'ㅂ': 17, 'ㅄ': 18, 'ㅅ': 19, 'ㅆ': 20,
  'ㅇ': 21, 'ㅈ': 22, 'ㅊ': 23, 'ㅋ': 24, 'ㅌ': 25, 'ㅍ': 26, 'ㅎ': 27,
};
const VOWEL_COMBINE: Record<string, string> = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
};
const FINAL_COMBINE: Record<string, string> = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ',
  'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
};
const CONSONANT_SET = new Set(Object.keys(CHOSEONG_INDEX));
const VOWEL_SET = new Set(Object.keys(JUNGSEONG_INDEX));

function getChosung(c: string): string {
  const code = c.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3)
    return CHOSUNG[Math.floor((code - 0xAC00) / 588)] ?? c;
  return c;
}

function stripLastJongseong(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return s;
  const jongseong = (last - 0xAC00) % 28;
  if (jongseong === 0) return s;
  return s.slice(0, -1) + String.fromCharCode(last - jongseong);
}

function isAllChosung(s: string): boolean {
  return s.length > 0 && Array.from(s).every((c) => {
    const code = c.charCodeAt(0);
    return code >= 0x3131 && code <= 0x314E;
  });
}

function composeHangulSyllable(initial: string, medial: string, finalConsonant = ''): string {
  const l = CHOSEONG_INDEX[initial];
  const v = JUNGSEONG_INDEX[medial];
  const t = JONGSEONG_INDEX[finalConsonant] ?? 0;
  if (l == null || v == null) return initial + medial + finalConsonant;
  return String.fromCharCode(0xAC00 + (l * 21 + v) * 28 + t);
}

function englishToKoreanTyped(input: string): string | null {
  const chars = Array.from(input);
  const jamoSeq: string[] = [];
  for (const c of chars) {
    const mapped = ENG_TO_JAMO[c];
    if (!mapped) return null;
    jamoSeq.push(mapped);
  }

  let out = '';
  let i = 0;
  while (i < jamoSeq.length) {
    const cur = jamoSeq[i]!;
    if (!CONSONANT_SET.has(cur)) {
      out += cur;
      i += 1;
      continue;
    }
    if (i + 1 >= jamoSeq.length || !VOWEL_SET.has(jamoSeq[i + 1]!)) {
      out += cur;
      i += 1;
      continue;
    }

    const initial = cur;
    let medial = jamoSeq[i + 1]!;
    let step = 2;
    if (i + 2 < jamoSeq.length && VOWEL_SET.has(jamoSeq[i + 2]!)) {
      const merged = VOWEL_COMBINE[medial + jamoSeq[i + 2]!];
      if (merged) {
        medial = merged;
        step = 3;
      }
    }

    let finalConsonant = '';
    const c1 = jamoSeq[i + step];
    const c2 = jamoSeq[i + step + 1];
    if (c1 && CONSONANT_SET.has(c1)) {
      // 다음 글자가 모음이면 받침 없이 다음 음절 초성으로 넘긴다.
      if (c2 && VOWEL_SET.has(c2)) {
        finalConsonant = '';
      } else if (c2 && CONSONANT_SET.has(c2)) {
        const mergedFinal = FINAL_COMBINE[c1 + c2];
        if (mergedFinal) {
          finalConsonant = mergedFinal;
          step += 2;
        } else {
          finalConsonant = c1;
          step += 1;
        }
      } else {
        finalConsonant = c1;
        step += 1;
      }
    }

    out += composeHangulSyllable(initial, medial, finalConsonant);
    i += step;
  }
  return out;
}

export function koreanIncludes(text: string, query: string): boolean {
  return koreanMatchScore(text, query) > 0;
}

/**
 * 본문 스니펫 위치 계산용 — text(소문자) 안에서 query(소문자)가 처음 나타나는 인덱스.
 * 직접 포함 → 영문 자모 변환(rkskek→가나다) → 마지막 받침 제거 순으로 시도.
 * 초성 매칭은 위치 계산이 모호하므로 여기서는 다루지 않는다(찾지 못하면 -1).
 * 성능: 본문 전체를 대상으로 호출되므로 초성 변환처럼 비싼 경로는 의도적으로 제외한다.
 */
export function koreanMatchOffset(textLower: string, queryLower: string): number {
  return koreanMatchRange(textLower, queryLower)?.index ?? -1;
}

/** koreanMatchOffset 의 매치 위치 + 길이 버전(스니펫 하이라이트 범위 계산용) */
export function koreanMatchRange(
  textLower: string,
  queryLower: string,
): { index: number; length: number } | null {
  if (!queryLower) return null;
  const candidates = [queryLower];
  const converted = englishToKoreanTyped(queryLower);
  if (converted && converted !== queryLower) candidates.push(converted);
  for (const q of candidates) {
    let idx = textLower.indexOf(q);
    if (idx >= 0) return { index: idx, length: q.length };
    const stripped = stripLastJongseong(q);
    if (stripped !== q) {
      idx = textLower.indexOf(stripped);
      if (idx >= 0) return { index: idx, length: stripped.length };
    }
  }
  return null;
}

export function koreanMatchScore(text: string, query: string): number {
  // macOS 등에서 분해형(NFD)으로 저장된 한글 제목과 조합형(NFC) 입력이 어긋나 매칭에
  // 실패하는 문제 방어 — 양쪽을 NFC 로 통일한다. 점수만 반환하므로 오프셋 영향 없음.
  text = text.normalize("NFC");
  query = query.normalize("NFC");
  const candidates = [query];
  const converted = englishToKoreanTyped(query);
  if (converted && converted !== query) candidates.push(converted);

  for (const q of candidates) {
    if (text === q) return 1200;
    if (text.startsWith(q)) return 900;
    if (text.includes(q)) return 500;
    const stripped = stripLastJongseong(q);
    if (stripped !== q) {
      if (text === stripped) return 1150;
      if (text.startsWith(stripped)) return 850;
      if (text.includes(stripped)) return 450;
    }
    if (!isAllChosung(q)) continue;
    const textChosung = Array.from(text).map(getChosung).join('');
    if (textChosung === q) return 380;
    if (textChosung.startsWith(q)) return 320;
    if (textChosung.includes(q)) return 260;
  }
  return 0;
}
