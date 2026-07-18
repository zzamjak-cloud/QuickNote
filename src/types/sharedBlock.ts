export const SHARED_BLOCK_SCHEMA_VERSION = 1;
export const DEFAULT_GALLERY_INTERVAL_MS = 5_000;

export type SharedBlockKind = "dropdown-menu" | "gallery";

export type DropdownMenuItem = {
  id: string;
  label: string;
  pageId: string;
  /** 편집 팝업에 표시할 연결 페이지 제목 스냅샷. */
  pageLabel?: string;
  /** 공개 뷰 변환 단계에서만 채워지는 내부 라우트 링크. */
  href?: string;
  /** 현재 공개/편집 페이지와 연결된 항목인지 표시한다. */
  active?: boolean;
};

export type DropdownMenuData = {
  kind: "dropdown-menu";
  items: DropdownMenuItem[];
};

export type GalleryImage = {
  id: string;
  src: string;
  alt: string;
};

export type GalleryData = {
  kind: "gallery";
  images: GalleryImage[];
  intervalMs: number;
};

export type SharedBlockData = DropdownMenuData | GalleryData;

export type SharedBlockRecord = {
  id: string;
  workspaceId: string | null;
  kind: SharedBlockKind;
  data: SharedBlockData;
  updatedAt: number;
  deletedAt: number | null;
};

const MAX_ITEMS = 50;

function objectValue(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function emptyDropdownMenu(): DropdownMenuData {
  return { kind: "dropdown-menu", items: [] };
}

export function emptyGallery(): GalleryData {
  return {
    kind: "gallery",
    images: [],
    intervalMs: DEFAULT_GALLERY_INTERVAL_MS,
  };
}

export function parseDropdownMenuData(raw: unknown): DropdownMenuData {
  const value = objectValue(raw);
  const rows = Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS) : [];
  return {
    kind: "dropdown-menu",
    items: rows.flatMap((row, index) => {
      const item = objectValue(row);
      if (!item) return [];
      const label = text(item.label, 100);
      const pageId = text(item.pageId, 200);
      const pageLabel = text(item.pageLabel, 200);
      const href = text(item.href, 500);
      return [
        {
          id: text(item.id, 200) || `menu-${index}`,
          label,
          pageId,
          ...(pageLabel ? { pageLabel } : {}),
          ...(href ? { href } : {}),
          ...(item.active === true ? { active: true } : {}),
        },
      ];
    }),
  };
}

export function parseGalleryData(raw: unknown): GalleryData {
  const value = objectValue(raw);
  const rows = Array.isArray(value?.images) ? value.images.slice(0, MAX_ITEMS) : [];
  const intervalRaw = Number(value?.intervalMs);
  const intervalMs = Number.isFinite(intervalRaw)
    ? Math.min(15_000, Math.max(3_000, Math.round(intervalRaw)))
    : DEFAULT_GALLERY_INTERVAL_MS;
  return {
    kind: "gallery",
    images: rows.flatMap((row, index) => {
      const item = objectValue(row);
      if (!item) return [];
      const src = text(item.src, 2_000);
      if (!src) return [];
      return [
        {
          id: text(item.id, 200) || `image-${index}`,
          src,
          alt: text(item.alt, 300),
        },
      ];
    }),
    intervalMs,
  };
}

export function parseSharedBlockData(
  kind: SharedBlockKind,
  raw: unknown,
): SharedBlockData {
  return kind === "gallery" ? parseGalleryData(raw) : parseDropdownMenuData(raw);
}

export function serializeSharedBlockData(data: SharedBlockData): string {
  return JSON.stringify(data);
}
