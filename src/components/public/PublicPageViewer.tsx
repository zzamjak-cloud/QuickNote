// /p/<token> 공개 페이지 뷰어 — 비로그인 읽기 전용.
// AuthGate·useSyncBootstrap·zustand 부트스트랩을 전혀 타지 않는다(Bootstrap 에서 분기).
// 렌더는 BlockDiffView 의 ReadOnlyBlocksPane 레시피(store 비의존 read-only TipTap)를 재사용한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEditorExtensions } from "../editor/useEditorExtensions";
import { EditorErrorBoundary } from "../editor/EditorErrorBoundary";
import {
  fetchPublicPage,
  fetchPublicSite,
  isPublicViewConfigured,
  type PublicPage,
  type PublicSite,
} from "../../lib/publicView/api";
import {
  transformPublicDoc,
  toPublicAssetUrl,
  type PublicDocContext,
} from "../../lib/publicView/transformPublicDoc";
import {
  decodeLucidePageIcon,
  isImageLikePageIcon,
} from "../../lib/pageIcon";
import { getEditorColumnClass } from "../../lib/editorLayout";

/** /p/<token> 에서 토큰 추출(쿼리·해시 제외) */
function parseTokenFromPath(pathname: string): string | null {
  const m = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

function parsePageIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("page");
  return id && id.length > 0 ? id : null;
}

/** 공개 뷰어용 페이지 아이콘 — 인증 없는 public asset URL 로 Lucide/이미지/이모지 표시 */
function PublicPageIcon({
  icon,
  ctx,
  size = 22,
  className = "mr-1.5",
}: {
  icon: string | null;
  ctx: PublicDocContext;
  size?: number;
  className?: string;
}) {
  const lucide = decodeLucidePageIcon(icon);
  if (lucide) {
    const Icon =
      (LucideIcons as unknown as Record<string, LucideIcon>)[lucide.name] ??
      LucideIcons.FileText;
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <Icon size={size} strokeWidth={1.9} color={lucide.color} />
      </span>
    );
  }
  if (isImageLikePageIcon(icon)) {
    const src = toPublicAssetUrl(icon, ctx);
    if (src) {
      return (
        <img
          src={src}
          alt=""
          className={`inline-block shrink-0 rounded object-cover ${className}`}
          style={{ width: size, height: size }}
          draggable={false}
        />
      );
    }
    return null;
  }
  if (!icon) return null;
  return <span className={className}>{icon}</span>;
}

function ReadOnlyDocView({
  doc,
  onNavigatePublicPage,
}: {
  doc: JSONContent;
  onNavigatePublicPage: (pageId: string) => void;
}) {
  const extensions = useEditorExtensions({
    lowlightApi: null,
    isFullPageDatabase: false,
    effectivePageId: null,
    myMemberId: undefined,
    collabDoc: null,
    collabAwareness: null,
  });
  const editor = useEditor(
    {
      extensions,
      content: doc,
      editable: false,
      // TipTap Link 는 openOnClick:false 라 기본 네비게이션이 막힌다.
      // 공개 라우트(/p/<token>?page=) 클릭만 SPA navigate 로 연결한다.
      editorProps: {
        attributes: {
          class:
            "prose prose-zinc dark:prose-invert max-w-none focus:outline-none md:px-12 py-4 qn-prose-marquee-host",
        },
        handleDOMEvents: {
          click: (_view, event) => {
            const target = event.target as HTMLElement | null;
            const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return false;
            const href = anchor.getAttribute("href") ?? "";
            const m = /^\/p\/[^/?#]+\?page=([^&]+)/.exec(href);
            if (!m?.[1]) return false;
            event.preventDefault();
            event.stopPropagation();
            onNavigatePublicPage(decodeURIComponent(m[1]));
            return true;
          },
        },
      },
    },
    [doc, onNavigatePublicPage],
  );
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function CenteredNotice({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white text-center dark:bg-zinc-950">
      <p className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
      {detail ? <p className="text-sm text-zinc-500">{detail}</p> : null}
    </div>
  );
}

export function PublicPageViewer() {
  const token = useMemo(() => parseTokenFromPath(window.location.pathname), []);
  const [site, setSite] = useState<PublicSite | null | undefined>(undefined);
  const [currentPageId, setCurrentPageId] = useState<string | null>(() =>
    parsePageIdFromSearch(window.location.search),
  );
  const [page, setPage] = useState<PublicPage | null | undefined>(undefined);

  // 검색엔진 비노출 — noindex meta 주입(서버 X-Robots-Tag 와 이중 방어).
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  // 사이트(트리) 로드
  useEffect(() => {
    if (!token || !isPublicViewConfigured()) {
      setSite(null);
      return;
    }
    let canceled = false;
    void fetchPublicSite(token)
      .then((s) => {
        if (!canceled) setSite(s);
      })
      .catch(() => {
        if (!canceled) setSite(null);
      });
    return () => {
      canceled = true;
    };
  }, [token]);

  const effectivePageId = currentPageId ?? site?.rootId ?? null;
  const publishedPageIds = useMemo(
    () => new Set((site?.pages ?? []).map((p) => p.id)),
    [site],
  );

  // 브라우저 뒤로가기 대응
  useEffect(() => {
    const onPop = () => setCurrentPageId(parsePageIdFromSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 페이지 본문 로드
  useEffect(() => {
    if (!token || !site || !effectivePageId) return;
    let canceled = false;
    setPage(undefined);
    void fetchPublicPage(token, effectivePageId)
      .then((p) => {
        if (!canceled) setPage(p);
      })
      .catch(() => {
        if (!canceled) setPage(null);
      });
    return () => {
      canceled = true;
    };
  }, [token, site, effectivePageId]);

  const navigateTo = useCallback(
    (id: string) => {
      if (!token) return;
      const url = id === site?.rootId ? `/p/${token}` : `/p/${token}?page=${id}`;
      window.history.pushState(null, "", url);
      setCurrentPageId(id === site?.rootId ? null : id);
    },
    [token, site],
  );

  const pageIcons = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of site?.pages ?? []) map.set(p.id, p.icon);
    return map;
  }, [site]);

  const publicDocCtx = useMemo((): PublicDocContext | null => {
    if (!token || !effectivePageId) return null;
    return {
      token,
      pageId: effectivePageId,
      publishedPageIds,
      pageIcons,
    };
  }, [token, effectivePageId, publishedPageIds, pageIcons]);

  const transformedDoc = useMemo(() => {
    if (!page || !publicDocCtx) return null;
    const rawDoc = page.doc as JSONContent | null;
    if (!rawDoc || typeof rawDoc !== "object") return null;
    return transformPublicDoc(rawDoc, publicDocCtx);
  }, [page, publicDocCtx]);

  const columnClass = getEditorColumnClass({
    fullWidth: page?.fullWidth === true,
    hasPageComments: false,
  });

  if (!token) {
    return <CenteredNotice title="잘못된 링크입니다." />;
  }
  if (site === undefined) {
    return <CenteredNotice title="불러오는 중…" />;
  }
  if (site === null) {
    const misconfigured = !isPublicViewConfigured();
    return (
      <CenteredNotice
        title="페이지를 찾을 수 없습니다."
        detail={
          misconfigured
            ? "공개 뷰어 설정(VITE_PUBLIC_VIEW_URL)이 없습니다. 배포 env를 확인하세요."
            : "게시가 해제되었거나, 다른 환경(dev/live)에서 발급된 링크일 수 있습니다."
        }
      />
    );
  }

  const coverSrc =
    page && publicDocCtx
      ? toPublicAssetUrl(page.coverImage, publicDocCtx)
      : null;

  return (
    <div className="min-h-screen overflow-y-auto bg-white dark:bg-zinc-950">
      {coverSrc && (
        <img
          src={coverSrc}
          alt=""
          className="h-48 w-full object-cover"
          draggable={false}
        />
      )}
      <div className={`mx-auto w-full py-10 ${columnClass}`}>
        {page === undefined ? (
          <p className="text-sm text-zinc-400">불러오는 중…</p>
        ) : page === null ? (
          <p className="text-sm text-zinc-500">이 페이지는 더 이상 공개되지 않습니다.</p>
        ) : (
          <div className="md:px-12">
            <h1
              className="mb-6 flex items-center gap-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100"
              style={page.titleColor ? { color: page.titleColor } : undefined}
            >
              {publicDocCtx ? (
                <PublicPageIcon icon={page.icon} ctx={publicDocCtx} size={32} className="" />
              ) : null}
              <span>{page.title || "제목 없음"}</span>
            </h1>
            {transformedDoc ? (
              <EditorErrorBoundary>
                <div className="qn-public-doc">
                  <ReadOnlyDocView
                    doc={transformedDoc}
                    onNavigatePublicPage={navigateTo}
                  />
                </div>
              </EditorErrorBoundary>
            ) : (
              <p className="text-sm text-zinc-400">내용이 없습니다.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
