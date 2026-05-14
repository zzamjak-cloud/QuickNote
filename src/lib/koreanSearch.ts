const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

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

export function koreanIncludes(text: string, query: string): boolean {
  if (text.includes(query)) return true;
  const stripped = stripLastJongseong(query);
  if (stripped !== query && text.includes(stripped)) return true;
  if (isAllChosung(query)) {
    const textChosung = Array.from(text).map(getChosung).join('');
    if (textChosung.includes(query)) return true;
  }
  return false;
}
