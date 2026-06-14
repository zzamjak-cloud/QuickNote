import JSZip from "jszip";
import type { JSONContent } from "@tiptap/react";
import { pageDocToHtml, type PageHtmlExportOptions } from "./pageToHtml";
import { collectDocAssetRefs } from "./collectDocAssets";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";
import { readMediaBlob, getMediaObjectUrl } from "../media/mediaBlobCache";

/** blob MIME 타입 → 자산 파일 확장자. 미상은 bin. */
function extForBlob(blob: Blob): string {
  switch (blob.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

/** ref → 미디어 id 추출 (image 우선, 그 다음 file). */
function mediaIdFromRef(ref: string): string | null {
  return decodeImageRef(ref) ?? decodeFileRef(ref);
}

/** id 로 캐시 바이트를 얻고, 미스 시 object URL 다운로드 후 blob 으로 받는다. 실패 시 null. */
async function loadBlobForId(id: string): Promise<Blob | null> {
  const cached = await readMediaBlob(id);
  if (cached) return cached;
  const objUrl = await getMediaObjectUrl(id);
  if (!objUrl) return null;
  try {
    const resp = await fetch(objUrl);
    if (!resp.ok) return null;
    return await resp.blob();
  } catch {
    return null;
  }
}

/** 파일 시스템·zip 안전 파일명으로 정리. 빈 값이면 untitled. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}

/**
 * 노션 자신의 내보내기처럼 HTML + 자산파일을 하나의 zip 으로 묶는다.
 * - 자산 ref 마다 미디어 바이트를 얻으면 assets/{id}.{ext} 로 추가하고 ref→경로 맵에 등록.
 * - 바이트 실패 ref 는 맵에서 제외되어 resolveAssetPath 가 null 을 돌려주므로 원본 src 가 유지된다(graceful).
 * - 옵션의 resolveCollection 은 그대로 전달해 DB 표를 함께 직렬화한다.
 */
export async function buildPageHtmlZipBlob(
  title: string,
  doc: JSONContent | null | undefined,
  options?: PageHtmlExportOptions,
): Promise<Blob> {
  const zip = new JSZip();
  const refToPath = new Map<string, string>();

  const refs = collectDocAssetRefs(doc);
  for (const ref of refs) {
    const id = mediaIdFromRef(ref);
    if (!id) continue;
    const blob = await loadBlobForId(id);
    if (!blob) continue;
    const path = `assets/${id}.${extForBlob(blob)}`;
    zip.file(path, blob);
    refToPath.set(ref, path);
  }

  const html = pageDocToHtml(title, doc, {
    ...options,
    resolveAssetPath: (ref) => refToPath.get(ref) ?? null,
  });

  zip.file(`${sanitizeFileName(title)}.html`, html);
  return zip.generateAsync({ type: "blob" });
}
