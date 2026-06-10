// memberId(또는 임의 seed) → 결정적 색. 모든 피어가 같은 사용자에게 같은 색을 본다.
// y-prosemirror selectionBuilder 가 `${color}70` 로 알파를 붙이므로 반드시 #RRGGBB 6자리 hex 여야 한다.

// 대비·식별성이 좋은 고정 팔레트(Tailwind 계열 진한 색).
const PALETTE = [
  "#e11d48", "#db2777", "#9333ea", "#7c3aed", "#4f46e5",
  "#2563eb", "#0891b2", "#059669", "#16a34a", "#ca8a04",
  "#ea580c", "#dc2626",
];

// 안정적 문자열 해시(djb2 변형). 같은 입력 → 같은 정수.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // 32비트로 고정
  }
  return Math.abs(h);
}

/** seed 를 팔레트의 한 색(#RRGGBB)으로 결정적 매핑한다. */
export function collabColor(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length];
}
