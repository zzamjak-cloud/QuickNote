export type QuickNoteLinkTarget = {
  pageId: string;
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
      block: Number.isFinite(block) ? block : null,
      tab: tabHash ? decodeURIComponent(tabHash[1] ?? "") : null,
    };
  } catch {
    return null;
  }
}

export function quickNoteLinkLabel(
  pageTitle: string | null | undefined,
  target: Pick<QuickNoteLinkTarget, "block" | "tab">,
): string {
  const title = pageTitle?.trim() || "페이지";
  if (target.block != null) return `${title} / 블럭 이동`;
  if (target.tab) return `${title} / 탭 이동`;
  return title;
}
