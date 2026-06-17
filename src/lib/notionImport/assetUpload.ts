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
  const byLeaf = new Map<string, NotionImportedAsset[]>();
  for (const asset of preview.assets) {
    const normalizedPath = normalizeAssetPath(asset.path);
    byPath.set(normalizedPath, asset);
    const leaf = normalizeMatchLeaf(normalizedPath);
    const bucket = byLeaf.get(leaf);
    if (bucket) bucket.push(asset);
    else byLeaf.set(leaf, [asset]);
  }

  return {
    resolve(src, currentPagePath) {
      const normalized = normalizeAssetPath(src);
      if (!normalized || isExternalAssetRef(normalized)) return null;

      const relative = resolveRelativeAssetPath(normalized, currentPagePath);
      const direct = byPath.get(relative) ?? byPath.get(normalized);
      if (direct) return direct;

      const suffix = relative ? `/${relative}` : "";
      const suffixMatched = preview.assets.find((asset) => {
        const assetPath = normalizeAssetPath(asset.path);
        return assetPath.endsWith(suffix) || assetPath.endsWith(`/${normalized}`) || assetPath.endsWith(normalized);
      });
      if (suffixMatched) return suffixMatched;

      // 파일명만 남는 Notion 경로 변형(공백/hex suffix/인코딩 차이) 대응.
      const leaf = normalizeMatchLeaf(normalized);
      const leafCandidates = byLeaf.get(leaf) ?? [];
      if (leafCandidates.length === 1) return leafCandidates[0] ?? null;
      if (leafCandidates.length > 1) {
        const currentDir = normalizeAssetPath(currentPagePath ?? "").split("/").slice(0, -1).join("/");
        const scored = leafCandidates
          .map((asset) => {
            const path = normalizeAssetPath(asset.path);
            const score = sharedDirScore(path, currentDir);
            return { asset, score };
          })
          .sort((a, b) => b.score - a.score);
        return scored[0]?.asset ?? null;
      }

      return null;
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

// 실패 자산을 사용자 안내용 짧은 사유로 변환한다. (용량 초과 / 빈 파일 / 기타)
// 한도값(50/100MB)이 경로별로 달라 특정 최대치는 명시하지 않고 실제 크기만 보여준다.
export function describeNotionAssetFailure(
  asset: Extract<UploadedNotionAsset, { kind: "failed" }>,
): string {
  const err = asset.error ?? "";
  if (/too large|용량/.test(err)) {
    const matched = err.match(/([\d.]+)\s*MB/);
    const sizeText = matched
      ? `${matched[1]}MB`
      : asset.size > 0
        ? `${(asset.size / 1024 / 1024).toFixed(1)}MB`
        : null;
    return sizeText ? `용량 초과 (${sizeText})` : "용량 초과";
  }
  if (/빈 파일|empty/.test(err)) return "빈 파일";
  return err || "업로드 실패";
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
  // Notion export 는 같은 폴더 안에서도 파일명/href 의 URL 인코딩 횟수가 불일치하는 경우가 있다.
  // (예: 디스크 파일명은 "%EB%A1%9C…"(1회 인코딩이 리터럴로 박힘), HTML href 는 "%25EB%25A1%259C…"(2회 인코딩))
  // 1회만 디코드하면 양쪽 표준형이 어긋나 자산 매칭이 깨지므로, 더 디코드되지 않을 때까지 반복 디코드해 수렴시킨다.
  let current = value;
  for (let i = 0; i < 5; i += 1) {
    if (!current.includes("%")) break;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function normalizeMatchLeaf(path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return safeDecode(leaf)
    .replace(/\.[^.]+$/, "")
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sharedDirScore(assetPath: string, currentDir: string): number {
  if (!assetPath || !currentDir) return 0;
  const a = assetPath.split("/").slice(0, -1);
  const b = currentDir.split("/");
  let i = a.length - 1;
  let j = b.length - 1;
  let score = 0;
  while (i >= 0 && j >= 0) {
    if (normalizeMatchLeaf(a[i] ?? "") !== normalizeMatchLeaf(b[j] ?? "")) break;
    score += 1;
    i -= 1;
    j -= 1;
  }
  return score;
}

function isExternalAssetRef(src: string): boolean {
  return /^(https?:|data:|blob:|quicknote-image:|quicknote-file:)/i.test(src);
}
