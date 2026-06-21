// 제목 색인용 정규화: 선두 화살표/기호 제거 → 연속 공백 1칸 → 소문자.
export function normalizeHeadingTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^[↑↓→←⬆⬇▲▼]+\s*/u, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// document(또는 root element) 의 h1~h6 을 스캔해 (정규화 제목 → { id, count }) 색인을 만든다.
// id 는 노션 export 의 heading el id attr(uuid). id 빈 heading 은 색인에서 제외.
export function buildHeadingTitleIndex(root: ParentNode): Map<string, { id: string; count: number }> {
  const index = new Map<string, { id: string; count: number }>();
  const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
  headings.forEach((h) => {
    if (!(h instanceof HTMLElement)) return;
    const id = (h.getAttribute("id") ?? "").trim();
    if (!id) return;
    const key = normalizeHeadingTitle(h.textContent ?? "");
    if (!key) return;
    const existing = index.get(key);
    if (existing) existing.count += 1;
    else index.set(key, { id, count: 1 });
  });
  return index;
}
