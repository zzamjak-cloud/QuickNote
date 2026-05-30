import { FILE_SCHEME } from "../files/scheme";
import { IMAGE_SCHEME } from "../sync/imageScheme";

function decodeVirtualAssetRef(value: string): string | null {
  const scheme = value.startsWith(IMAGE_SCHEME)
    ? IMAGE_SCHEME
    : value.startsWith(FILE_SCHEME)
      ? FILE_SCHEME
      : null;
  if (!scheme) return null;
  const id = value.slice(scheme.length).split("?")[0]?.split("#")[0] ?? "";
  return id.length > 0 ? id : null;
}

export function collectCustomIconAssetIds(
  icons: Array<{ src?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const icon of icons) {
    const src = icon.src;
    if (!src) continue;
    const assetId = decodeVirtualAssetRef(src);
    if (assetId) ids.add(assetId);
  }
  return ids;
}
