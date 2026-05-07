// 노션 클립보드의 콜아웃 wrapper 를 퀵노트 콜아웃 마크업으로 사전 변환한다.
// PM 의 parseHTML rule 만으로는 노션의 깊은 wrapper 구조(role=note + 다중 notion-* div + content-editable-leaf)를
// 안정적으로 매칭하기 어렵기 때문에 paste 직후(transformPastedHTML) 단계에서 직접 변환한다.
//
// 변환 규칙:
// 1) <div role="note" aria-roledescription="콜아웃|callout"> 발견.
// 2) 그 안의 [data-content-editable-leaf="true"] 들에서 텍스트만 줄 단위로 추출.
// 3) <div data-callout="" data-preset="idea"><div class="callout-body"><p>...</p></div></div> 로 교체.
//
// 부수 효과: 본문의 굵은 텍스트·링크·리스트 마커 등은 일반 paragraph 로 평탄화된다.
// 정확한 구조 보존보다 "정보(텍스트) 보존 + 콜아웃으로 감싸기" 우선.
export function transformNotionCalloutHtml(html: string): string {
  if (!/aria-roledescription="(콜아웃|callout)"/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll('div[role="note"][aria-roledescription]').forEach(
    (root) => {
      const desc = (root as HTMLElement).getAttribute("aria-roledescription") ?? "";
      if (!/콜아웃|callout/i.test(desc)) return;
      const leaves = root.querySelectorAll('[data-content-editable-leaf="true"]');
      const lines: string[] = [];
      if (leaves.length > 0) {
        leaves.forEach((leaf) => {
          const t = (leaf.textContent ?? "").trim();
          if (t) lines.push(t);
        });
      } else {
        const t = (root.textContent ?? "").trim();
        if (t) lines.push(t);
      }
      const wrap = doc.createElement("div");
      wrap.setAttribute("data-callout", "");
      wrap.setAttribute("data-preset", "idea");
      const body = doc.createElement("div");
      body.className = "callout-body";
      if (lines.length === 0) {
        body.appendChild(doc.createElement("p"));
      } else {
        for (const line of lines) {
          const p = doc.createElement("p");
          p.textContent = line;
          body.appendChild(p);
        }
      }
      wrap.appendChild(body);
      (root as HTMLElement).replaceWith(wrap);
    },
  );
  return doc.body.innerHTML;
}
