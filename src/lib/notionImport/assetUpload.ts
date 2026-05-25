import type { JSONContent } from "@tiptap/react";
import { uploadFile } from "../files/upload";
import { prepareImageFileForUpload } from "../images/compressImage";
import { uploadImage } from "../images/upload";
import type { NotionImportedAsset, NotionZipPreview } from "./zipParser";

const IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
// 대형 GIF/파일은 메모리 폭증·브라우저 FFmpeg 변환 시도를 피하기 위해 사전 차단 (실패 첨부로 처리)
const NOTION_ASSET_MAX_BYTES = 50 * 1024 * 1024;

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
  html: string | Document,
  currentPagePath: string,
  resolver: NotionAssetResolver,
): NotionImportedAsset[] {
  if (typeof html === "string" && typeof DOMParser === "undefined") return [];
  const doc = typeof html === "string"
    ? new DOMParser().parseFromString(html, "text/html")
    : html;
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
  // 사이즈 사전 검사 — 임계치 초과 시 파일 읽기 자체를 생략 (메모리 절약).
  if (asset.size > NOTION_ASSET_MAX_BYTES) {
    return {
      kind: "failed",
      path: asset.path,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
      error: `용량이 너무 큼 (${asset.size} > ${NOTION_ASSET_MAX_BYTES} bytes)`,
    };
  }
  // 0바이트 파일은 업로드 자체가 실패하므로 사전 차단 (notion zip 내부에 빈 파일이 섞여 있는 경우)
  if (asset.size === 0) {
    return {
      kind: "failed",
      path: asset.path,
      name: asset.name,
      mimeType: asset.mimeType,
      size: 0,
      error: "빈 파일",
    };
  }

  const file = await asset.readAsFile();
  // readAsFile 이 zip 손상 등으로 0바이트를 반환하는 경우도 동일하게 처리
  if (file.size === 0) {
    return {
      kind: "failed",
      path: asset.path,
      name: asset.name,
      mimeType: asset.mimeType,
      size: 0,
      error: "빈 파일(읽기 결과 0바이트)",
    };
  }

  // GIF — 원본 그대로 fileBlock 으로 업로드 (애니메이션 보존).
  if (asset.mimeType === "image/gif") {
    const uploaded = await uploadFile(file);
    return {
      kind: "file",
      path: asset.path,
      src: uploaded.ref,
      name: uploaded.name,
      mimeType: "image/gif",
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

  // 동영상·기타 파일 — 원본 그대로 업로드.
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
