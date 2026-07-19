export const SHARED_BLOCK_SCHEMA_VERSION = 1;
export const DEFAULT_GALLERY_INTERVAL_MS = 5_000;
export const DEFAULT_GALLERY_HEIGHT_PX = 320;
export const MIN_GALLERY_HEIGHT_PX = 180;
export const MAX_GALLERY_HEIGHT_PX = 800;

export type SharedBlockKind = "dropdown-menu" | "gallery";
export type SharedBlockAlign = "left" | "center" | "right";

export function normalizeSharedBlockAlign(value: unknown): SharedBlockAlign {
  return value === "center" || value === "right" ? value : "left";
}

export function normalizeGalleryHeightPx(value: unknown): number {
  const height = Number(value);
  return Number.isFinite(height)
    ? Math.min(MAX_GALLERY_HEIGHT_PX, Math.max(MIN_GALLERY_HEIGHT_PX, Math.round(height)))
    : DEFAULT_GALLERY_HEIGHT_PX;
}

export type DropdownMenuItem = {
  id: string;
  label: string;
  pageId: string;
  /** 편집 팝업에 표시할 연결 페이지 제목 스냅샷. */
  pageLabel?: string;
  /** 공개 뷰에서만 채워지는 현재 게시 트리 또는 독립 게시 루트 링크. */
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
  heightPx: number;
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
  let value = raw;
  // AppSync AWSJSON 응답은 호출 경로에 따라 직렬화 문자열을 한 번 더 감싸서
  // 반환할 수 있다. 공유 레코드는 서버 저장본이 권위이므로 최대 두 번까지 풀어
  // 정상 데이터를 빈 메뉴/갤러리로 덮어쓰는 일을 막는다.
  for (let depth = 0; depth < 2 && typeof value === "string"; depth += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
    heightPx: DEFAULT_GALLERY_HEIGHT_PX,
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
  const heightPx = normalizeGalleryHeightPx(value?.heightPx);
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
    heightPx,
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
