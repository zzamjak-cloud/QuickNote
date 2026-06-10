import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isTrustedYoutubeInput, sanitizeWebLinkHref } from "../safeUrl";
import { parseQuickNoteLink } from "../navigation/quicknoteLinks";

/**
 * 붙여넣기 링크 선택지 및 블록 변환에서 공통으로 쓰는 링크 표현 형식.
 * - mention: 인라인 멘션성 버튼(라벨=호스트)
 * - url: 인라인 텍스트 링크
 * - bookmark: 북마크 카드 블록
 * - embed: 유튜브 임베드(신뢰 URL) 또는 버튼 블록
 */
export type LinkBlockMode = "mention" | "url" | "bookmark" | "embed";

/** URL 에서 호스트명(www. 제거)을 추출. 실패 시 fallback 반환. */
function hostFromUrl(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

/**
 * 선택한 모드대로 range 를 비우고 링크 표현을 삽입한다.
 * 붙여넣기 선택지와 드래그핸들 "링크 형식 변환" 메뉴가 공유한다.
 */
export function applyLinkBlockChoice(
  editor: Editor,
  params: { url: string; range: { from: number; to: number }; mode: LinkBlockMode },
): void {
  const { url, range, mode } = params;
  const normalizedUrl = sanitizeWebLinkHref(url) ?? url;

  // 삽입할 콘텐츠를 모드별로 구성한다.
  // 주의: deleteRange + insertContent 조합은 현재 selection 에 의존하므로,
  // 드래그핸들에서 호출될 때(에디터 selection 이 클릭 위치와 무관) 엉뚱한 위치(문서 끝)에
  // 삽입되고 undo 도 깨진다. 위치를 명시하는 insertContentAt(range, ...) 로 단일 트랜잭션 교체.
  let content: Record<string, unknown>;
  if (mode === "embed" && isTrustedYoutubeInput(normalizedUrl)) {
    // youtube 노드명은 @tiptap/extension-youtube 기본값("youtube").
    content = { type: "youtube", attrs: { src: normalizedUrl } };
  } else if (mode === "url") {
    content = {
      type: "text",
      text: normalizedUrl,
      marks: [{ type: "link", attrs: { href: normalizedUrl } }],
    };
  } else if (mode === "bookmark") {
    const host = hostFromUrl(normalizedUrl, "웹 페이지");
    content = {
      type: "bookmarkBlock",
      attrs: {
        href: normalizedUrl,
        title: host,
        description: normalizedUrl,
        siteName: host,
        status: "loading",
      },
    };
  } else {
    // mention | embed(비유튜브) → 버튼 블록
    const host = hostFromUrl(normalizedUrl, "링크");
    content = {
      type: "buttonBlock",
      attrs: {
        label: mode === "mention" ? host : `북마크 · ${host}`,
        href: normalizedUrl,
      },
    };
  }

  editor.chain().focus().insertContentAt(range, content).run();
}

// 외부 웹 링크 href 만 변환 대상으로 통과시킨다(내부 페이지 링크·잘못된 URL 제외).
function externalWebHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (parseQuickNoteLink(trimmed)) return null;
  return sanitizeWebLinkHref(trimmed) ? trimmed : null;
}

/**
 * 문단이 "순수 링크"인 경우 그 href 를 반환한다. 두 형태를 인식한다:
 *  - 인라인 buttonBlock 아톰 1개로만 구성된 문단 (멘션/버튼 모드 결과)
 *  - 전체가 동일한 link 마크 텍스트로 덮인 문단 (URL 모드 결과)
 * 링크가 아닌 텍스트/노드가 섞여 있으면(문단 일부만 링크) 변환 대상이 아니다 → null.
 *
 * 주의: buttonBlock 은 group:"inline" atom 이라 textContent 에 기여하지 않는다.
 * 과거 `textContent.trim()` 빈값 가드가 buttonBlock-only 문단을 잘못 제외했었다.
 */
function pureLinkParagraphHref(para: PMNode): string | null {
  if (para.childCount === 0) return null;
  let href: string | null = null;
  let ok = true;
  para.forEach((child) => {
    if (!ok) return;
    if (child.isText) {
      // 공백뿐인 텍스트는 무시(링크 앞뒤 공백 허용).
      if (!(child.text ?? "").trim()) return;
      const linkMark = child.marks.find((m) => m.type.name === "link");
      const h = typeof linkMark?.attrs.href === "string" ? linkMark.attrs.href : "";
      if (!h) {
        ok = false;
        return;
      }
      if (href === null) href = h;
      else if (href !== h) ok = false;
      return;
    }
    if (child.type.name === "buttonBlock") {
      const h = typeof child.attrs.href === "string" ? child.attrs.href : "";
      if (!h || href !== null) {
        ok = false;
        return;
      }
      href = h;
      return;
    }
    // 그 외 노드(이미지·멘션 등)가 있으면 순수 링크 문단이 아니다.
    ok = false;
  });
  if (!ok || !href) return null;
  return externalWebHref(href);
}

/**
 * 드래그핸들에서 링크 형식 변환이 가능한 블록인지 판별하고 원본 URL 을 추출한다.
 * 변환 대상: buttonBlock·bookmarkBlock(href), youtube(src), 순수 링크 문단(인라인 URL).
 * 변환 불가 블록이면 null.
 */
export function getConvertibleLinkHref(node: PMNode | null | undefined): string | null {
  if (!node) return null;
  const name = node.type.name;
  if (name === "buttonBlock" || name === "bookmarkBlock") {
    const href = typeof node.attrs.href === "string" ? node.attrs.href : "";
    return externalWebHref(href);
  }
  if (name === "youtube") {
    const src = typeof node.attrs.src === "string" ? node.attrs.src.trim() : "";
    return src || null;
  }
  if (name === "paragraph") {
    return pureLinkParagraphHref(node);
  }
  return null;
}
