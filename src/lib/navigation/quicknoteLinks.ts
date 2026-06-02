export type QuickNoteLinkTarget = {
  pageId: string;
  /** 블록 노드 attrs.id — 페이지 편집(블록 추가/삭제)에도 안전한 기준. 우선 사용. */
  blockId?: string | null;
  /** 블록 시작 PM 위치 — blockId 가 없는(레거시) 링크의 폴백. */
  block?: number | null;
  tab?: string | null;
};

export function buildQuickNotePageUrl(target: QuickNoteLinkTarget): string {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  const params = new URLSearchParams();
  params.set("page", target.pageId);
  // blockId 우선(편집에도 안전). 구버전 호환·폴백용으로 숫자 위치도 함께 싣는다.
  if (target.blockId) {
    params.set("blockId", target.blockId);
  }
  if (typeof target.block === "number" && Number.isFinite(target.block)) {
    params.set("block", String(target.block));
  }
  const hash = target.tab ? `#tab-${encodeURIComponent(target.tab)}` : "";
  return `${base}?${params.toString()}${hash}`;
}

export function parseQuickNoteLink(raw: string): QuickNoteLinkTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("quicknote://page/")) {
    try {
      const url = new URL(trimmed);
      const pageId = url.pathname.replace(/^\/+/, "");
      if (!pageId) return null;
      const blockRaw = url.searchParams.get("block");
      const block = blockRaw == null ? null : Number(blockRaw);
      return {
        pageId,
        blockId: url.searchParams.get("blockId"),
        block: Number.isFinite(block) ? block : null,
        tab: null,
      };
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(trimmed);
    const pageId = url.searchParams.get("page");
    if (!pageId) return null;
    const blockRaw = url.searchParams.get("block");
    const block = blockRaw == null ? null : Number(blockRaw);
    const tabHash = url.hash.match(/^#tab-(.+)$/);
    return {
      pageId,
      blockId: url.searchParams.get("blockId"),
      block: Number.isFinite(block) ? block : null,
      tab: tabHash ? decodeURIComponent(tabHash[1] ?? "") : null,
    };
  } catch {
    return null;
  }
}

export function quickNoteLinkLabel(
  pageTitle: string | null | undefined,
  target: Pick<QuickNoteLinkTarget, "blockId" | "block" | "tab">,
): string {
  const title = pageTitle?.trim() || "페이지";
  if (target.blockId || target.block != null) return `${title} / 블럭 이동`;
  if (target.tab) return `${title} / 탭 이동`;
  return title;
}
