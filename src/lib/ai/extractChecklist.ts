// AI 응답에서 GFM 체크리스트만 추출 — actionItems 가드용.
// 서문·후문이 섞여도 `- [ ]` / `- [x]` 줄만 남긴다.

const CHECKLIST_LINE = /^\s*[-*] \[([ xX])\]\s+(.+)$/;

/** 마크다운에서 체크리스트 항목만 모아 GFM 으로 재조립. 없으면 null. */
export function extractChecklistMarkdown(raw: string): string | null {
  const lines = raw.split(/\r?\n/);
  const items: string[] = [];
  for (const line of lines) {
    const m = line.match(CHECKLIST_LINE);
    if (!m) continue;
    const checked = m[1]!.toLowerCase() === "x";
    const text = m[2]!.trim();
    if (!text) continue;
    items.push(`- [${checked ? "x" : " "}] ${text}`);
  }
  if (items.length === 0) return null;
  return items.join("\n");
}

/** 삽입용 — 체크리스트를 뽑고, 없으면 원문(빈 응답·"실행 항목 없음" 등)을 그대로 반환. */
export function checklistMarkdownForInsert(raw: string): string {
  return extractChecklistMarkdown(raw) ?? raw.trim();
}

export function looksLikeChecklist(raw: string): boolean {
  return extractChecklistMarkdown(raw) != null;
}
