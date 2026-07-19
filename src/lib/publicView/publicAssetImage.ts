/**
 * 공개 asset CDN URL 은 다른 origin(CloudFront)에서 내려오므로 `<img>`가 no-cors 로
 * 요청하면 일부 WebP 응답이 Chrome ORB 경로에서 차단될 수 있다.
 * op=asset 공개 URL 에만 anonymous CORS 를 붙여 일반 에디터 presigned URL 로딩은 건드리지 않는다.
 */
export function publicAssetImageCrossOrigin(
  url: string | null | undefined,
): "anonymous" | undefined {
  if (!url) return undefined;
  try {
    const base =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "https://quicknote.local/";
    const parsed = new URL(url, base);
    return parsed.searchParams.get("op") === "asset" &&
      parsed.searchParams.has("token") &&
      parsed.searchParams.has("assetId")
      ? "anonymous"
      : undefined;
  } catch {
    return undefined;
  }
}
