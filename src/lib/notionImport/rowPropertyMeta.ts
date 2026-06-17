// Notion 행(레코드) 페이지 HTML 의 `<table class="properties">` 에서 컬럼 메타를 추출한다.
//
// 메인 DB HTML 의 collection-content 뷰는 "보이는 속성"만 노출하므로(숨김 컬럼 제외),
// 체크박스/셀렉트 등 숨은 컬럼의 정확한 타입·옵션 색을 잃는다. 반면 각 행 페이지의
// properties 테이블은 모든 속성을 `property-row-<notionType>` 클래스 + 색 토큰과 함께
// 내보내므로, 이를 권위 소스로 삼아 컬럼 타입·옵션 색을 복원한다.

export type NotionRowPropertyMeta = {
  header: string;
  // Notion 원본 타입(예: select, multi_select, checkbox, created_time, person ...)
  notionType: string;
  options: Array<{ label: string; colorToken: string | null }>;
};

const COLOR_PREFIXES = [
  "select-value-color-",
  "selected-value-color-",
  "status-value-color-",
];

function colorTokenFromClass(className: string): string | null {
  for (const cls of className.split(/\s+/)) {
    for (const prefix of COLOR_PREFIXES) {
      if (cls.startsWith(prefix)) {
        const token = cls.slice(prefix.length);
        return token === "default" ? null : token;
      }
    }
  }
  return null;
}

// 전체 행 HTML 을 통째로 DOM 파싱하면 행마다 비용이 커 OOM 위험이 있으므로,
// properties 테이블 조각만 정규식으로 잘라 작은 DOM 으로 파싱한다.
const PROPERTIES_TABLE_RE = /<table class="properties">[\s\S]*?<\/table>/i;

export function parseNotionRowProperties(html: string): NotionRowPropertyMeta[] {
  if (typeof DOMParser === "undefined") return [];
  const fragment = html.match(PROPERTIES_TABLE_RE)?.[0];
  if (!fragment) return [];

  const doc = new DOMParser().parseFromString(fragment, "text/html");
  const out: NotionRowPropertyMeta[] = [];
  for (const tr of Array.from(doc.querySelectorAll("tr.property-row"))) {
    const typeClass = Array.from(tr.classList).find(
      (c) => c.startsWith("property-row-") && c !== "property-row",
    );
    const notionType = typeClass ? typeClass.replace("property-row-", "") : "";
    const header = (tr.querySelector("th")?.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!header) continue;

    const options: NotionRowPropertyMeta["options"] = [];
    const td = tr.querySelector("td");
    if (td) {
      const spans = Array.from(
        td.querySelectorAll("span.selected-value, [class*='selected-value']"),
      ).filter((n): n is HTMLElement => n instanceof HTMLElement);
      for (const span of spans) {
        const label = (span.textContent ?? "").trim();
        if (!label) continue;
        options.push({ label, colorToken: colorTokenFromClass(span.className) });
      }
    }
    out.push({ header, notionType, options });
  }
  return out;
}
