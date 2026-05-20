import type { JSONContent } from "@tiptap/react";
import { uploadFile } from "../files/upload";
import { prepareGifFileBlockForUpload } from "../files/videoCompress";
import { prepareImageFileForUpload } from "../images/compressImage";
import { uploadImage } from "../images/upload";
import type { NotionImportedAsset, NotionZipPreview } from "./zipParser";

const IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const GIF_WASM_TRANSCODE_MAX_BYTES = 40 * 1024 * 1024;

const IMAGE_NODE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type UploadedNotionAsset = {
  kind: "image";
  path: string;
  src: string;
  name: string;
  mimeType: string;
  size: number;
} | {
  kind: "file";
  path: string;
  src: string;
  name: string;
  mimeType: string;
  size: number;
} | {
  kind: "failed";
  path: string;
  name: string;
  mimeType: string;
  size: number;
  error: string;
};

export type NotionAssetResolver = {
  resolve: (src: string, currentPagePath?: string) => NotionImportedAsset | null;
};

export function createNotionAssetResolver(preview: NotionZipPreview): NotionAssetResolver {
  const byPath = new Map<string, NotionImportedAsset>();
  for (const asset of preview.assets) {
    byPath.set(normalizeAssetPath(asset.path), asset);
  }

  return {
    resolve(src, currentPagePath) {
      const normalized = normalizeAssetPath(src);
      if (!normalized || isExternalAssetRef(normalized)) return null;

      const relative = resolveRelativeAssetPath(normalized, currentPagePath);
      const direct = byPath.get(relative) ?? byPath.get(normalized);
      if (direct) return direct;

      const suffix = relative ? `/${relative}` : "";
      return preview.assets.find((asset) => {
        const assetPath = normalizeAssetPath(asset.path);
        return assetPath.endsWith(suffix) || assetPath.endsWith(`/${normalized}`) || assetPath.endsWith(normalized);
      }) ?? null;
    },
  };
}

export function collectNotionAssetRefsFromHtml(
  html: string,
  currentPagePath: string,
  resolver: NotionAssetResolver,
): NotionImportedAsset[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const attrs: Array<[string, string]> = [
    ["img[src]", "src"],
    ["video[src]", "src"],
    ["source[src]", "src"],
    ["a[href]", "href"],
  ];
  const seen = new Set<string>();
  const out: NotionImportedAsset[] = [];

  for (const [selector, attr] of attrs) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      if (!(el instanceof HTMLElement)) continue;
      const raw = el.getAttribute(attr);
      if (!raw) continue;
      const asset = resolver.resolve(raw, currentPagePath);
      if (!asset || seen.has(asset.path)) continue;
      seen.add(asset.path);
      out.push(asset);
    }
  }

  return out;
}

export async function uploadNotionAsset(asset: NotionImportedAsset): Promise<UploadedNotionAsset> {
  if (asset.mimeType === "image/gif" && asset.size > GIF_WASM_TRANSCODE_MAX_BYTES) {
    return failedNotionAsset(
      asset,
      `GIF가 ${(asset.size / 1024 / 1024).toFixed(1)}MB라서 브라우저 MP4 변환 한도를 초과했습니다.`,
    );
  }

  const file = await asset.readAsFile();
  if (asset.mimeType === "image/gif") {
    const compressedVideo = await prepareGifFileBlockForUpload(file);
    const uploaded = await uploadFile(compressedVideo, { alreadyPrepared: true });
    return {
      kind: "file",
      path: asset.path,
      src: uploaded.ref,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    };
  }

  if (asset.mimeType.startsWith("image/")) {
    const prepared = await prepareImageFileForUpload(file);
    if (IMAGE_NODE_MIME.has(prepared.type) && prepared.size <= IMAGE_UPLOAD_MAX_BYTES) {
      const ref = await uploadImage(prepared);
      return {
        kind: "image",
        path: asset.path,
        src: ref,
        name: prepared.name,
        mimeType: prepared.type,
        size: prepared.size,
      };
    }
  }

  const uploaded = await uploadFile(file);
  return {
    kind: "file",
    path: asset.path,
    src: uploaded.ref,
    name: uploaded.name,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
  };
}

export function failedNotionAsset(asset: NotionImportedAsset, error: unknown): UploadedNotionAsset {
  return {
    kind: "failed",
    path: asset.path,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function uploadedAssetToDocNode(
  uploaded: UploadedNotionAsset,
  alt = "",
): JSONContent | null {
  if (uploaded.kind === "image") {
    return {
      type: "image",
      attrs: {
        src: uploaded.src,
        alt,
      },
    };
  }
  if (uploaded.kind === "file") {
    return {
      type: "fileBlock",
      attrs: {
        src: uploaded.src,
        name: uploaded.name,
        size: uploaded.size,
        mime: uploaded.mimeType,
      },
    };
  }
  return {
    type: "fileBlock",
    attrs: {
      name: uploaded.name,
      size: uploaded.size,
      mime: uploaded.mimeType,
      uploadError: true,
    },
  };
}

function normalizeAssetPath(value: string): string {
  const withoutHash = value.split("#")[0]?.split("?")[0] ?? value;
  const decoded = safeDecode(withoutHash);
  return decoded
    .replace(/\\/g, "/")
    .replace(/^file:\/+/i, "")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .trim();
}

function resolveRelativeAssetPath(src: string, currentPagePath?: string): string {
  if (!currentPagePath || src.startsWith("/")) return normalizeAssetPath(src);
  const base = normalizeAssetPath(currentPagePath).split("/").slice(0, -1);
  for (const segment of normalizeAssetPath(src).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isExternalAssetRef(src: string): boolean {
  return /^(https?:|data:|blob:|quicknote-image:|quicknote-file:)/i.test(src);
}
