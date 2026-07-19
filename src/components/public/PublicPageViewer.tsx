// /p/<token> 공개 페이지 뷰어 — 비로그인 읽기 전용.
// AuthGate·useSyncBootstrap·zustand 부트스트랩을 전혀 타지 않는다(Bootstrap 에서 분기).
// 렌더는 BlockDiffView 의 ReadOnlyBlocksPane 레시피(store 비의존 read-only TipTap)를 재사용한다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import * as LucideIcons from "lucide-react";
import { ChevronRight, Hash, ListTree, X } from "lucide-react";
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
import { PublicBreadcrumbBar } from "./PublicBreadcrumbBar";
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
import { extractOutlineFromDocJson, type OutlineItem } from "../../lib/pageOutline";
import { resolvePublicViewerLinkAction } from "../../lib/publicView/publicLinks";
import { scrollPublicOutlineTargetIntoView } from "../../lib/publicView/publicOutline";
import {
  PUBLIC_OUTLINE_SIDEBAR_WIDTH_CLASS,
  getPublicViewerShellClassName,
} from "../../lib/publicView/publicViewerLayout";

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
  publishedPageIds,
  onNavigatePublicPage,
}: {
  doc: JSONContent;
  publishedPageIds: ReadonlySet<string>;
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
  // 네비게이션 콜백을 ref 로 참조해 editor 를 doc 변경 시 재생성하지 않는다.
  // (deps 에 doc/콜백을 넣으면 페이지 이동마다 에디터가 언마운트→마운트되며 높이가 한 프레임
  //  붕괴해 멘션 리스트가 출렁이고 인라인 아이콘이 재연결된다.)
  const onNavRef = useRef(onNavigatePublicPage);
  onNavRef.current = onNavigatePublicPage;
  // 최초 생성 시 content:doc 로 이미 반영되므로 초기값을 doc 으로 둬 중복 setContent 를 막는다.
  const lastDocRef = useRef<JSONContent | null>(doc);
  const editor = useEditor({
    extensions,
    content: doc,
    editable: false,
    // TipTap Link 는 openOnClick:false 라 기본 네비게이션이 막힌다.
    // 공개 라우트(/p/<token>?page=) 클릭만 SPA navigate 로 연결한다.
    editorProps: {
      attributes: {
        class:
          "prose prose-zinc dark:prose-invert max-w-none focus:outline-none px-4 md:px-12 py-4 qn-prose-marquee-host",
      },
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const button = target?.closest?.("[data-qn-button-block]") as HTMLElement | null;
          if (button?.closest(".ProseMirror")) {
            const action = resolvePublicViewerLinkAction(
              button.getAttribute("data-href") ?? "",
              publishedPageIds,
              { currentOrigin: window.location.origin },
            );
            if (!action) return false;
            event.preventDefault();
            event.stopPropagation();
            if (action.kind === "navigate") {
              onNavRef.current(action.pageId);
            } else if (action.kind === "navigatePublic") {
              window.location.assign(action.href);
            } else {
              window.open(action.href, "_blank", "noopener,noreferrer");
            }
            return true;
          }

          const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!anchor) return false;
          const href = anchor.getAttribute("href") ?? "";
          const action = resolvePublicViewerLinkAction(href, publishedPageIds, {
            currentOrigin: window.location.origin,
          });
          if (!action) return false;
          event.preventDefault();
          event.stopPropagation();
          if (action.kind === "navigate") {
            onNavRef.current(action.pageId);
          } else if (action.kind === "navigatePublic") {
            window.location.assign(action.href);
          } else {
            window.open(action.href, "_blank", "noopener,noreferrer");
          }
          return true;
        },
      },
    },
  });

  // 페이지 이동 시 에디터를 재생성하지 않고 내용만 교체(read-only 라 커서/선택 무관) —
  // 전체 언마운트로 인한 컨테이너 높이 붕괴(리스트 출렁임)를 없앤다.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // 동일 doc 재적용 방지 — 참조가 같으면(캐시 히트) 건너뛴다.
    if (lastDocRef.current === doc) return;
    lastDocRef.current = doc;
    editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, doc]);

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

function PublicOutlineSidebar({
  open,
  outline,
  onClose,
  onJump,
}: {
  open: boolean;
  outline: OutlineItem[];
  onClose: () => void;
  onJump: (index: number) => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="목차 닫기"
        className="fixed inset-0 z-20 bg-black/20 md:hidden"
        onClick={onClose}
      />
      <aside
        id="qn-public-outline-sidebar"
        aria-label="공개 페이지 목차"
        className={[
          "fixed right-0 top-0 z-30 flex h-dvh flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950",
          PUBLIC_OUTLINE_SIDEBAR_WIDTH_CLASS,
        ].join(" ")}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <ListTree size={16} />
            목차
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="목차 닫기"
            title="목차 닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {outline.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs leading-relaxed text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              이 페이지에는 목차가 없습니다. `#` ~ `####` 헤더나 제목 토글이 있으면
              이곳에 표시됩니다.
            </div>
          ) : (
            <nav aria-label="페이지 목차" className="space-y-1">
              {outline.map((item, idx) => (
                <button
                  key={`${idx}-${item.kind}-${item.level}-${item.text}`}
                  type="button"
                  onClick={() => onJump(idx)}
                  className={[
                    "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
                    "dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                  ].join(" ")}
                  style={{ paddingLeft: `${item.level * 10}px` }}
                  title={item.text}
                >
                  {item.kind === "toggle" ? (
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-zinc-400 group-hover:text-violet-500 dark:group-hover:text-violet-300"
                    />
                  ) : (
                    <Hash
                      size={13}
                      className="shrink-0 text-zinc-400 group-hover:text-violet-500 dark:group-hover:text-violet-300"
                    />
                  )}
                  <span className="truncate">{item.text}</span>
                </button>
              ))}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}

export function PublicPageViewer() {
  const token = useMemo(() => parseTokenFromPath(window.location.pathname), []);
  const [site, setSite] = useState<PublicSite | null | undefined>(undefined);
  const [currentPageId, setCurrentPageId] = useState<string | null>(() =>
    parsePageIdFromSearch(window.location.search),
  );
  // 방문한 페이지 캐시(pageId → 결과). undefined=미로드, null=404, 객체=본문.
  // 루트↔자식 왕복 시 재요청·화면 비움(undefined 플래시)을 없애 아이콘 재연결 출렁임을 막는다.
  const pageCacheRef = useRef<Map<string, PublicPage | null>>(new Map());
  const [pageCacheVersion, setPageCacheVersion] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);

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

  // 뷰어 내 탐색 깊이 — 0 이면 브라우저 뒤로가기가 사이트 밖으로 나가므로 버튼을 비활성한다.
  const [backDepth, setBackDepth] = useState(0);

  // 브라우저 뒤로가기 대응
  useEffect(() => {
    const onPop = () => {
      setCurrentPageId(parsePageIdFromSearch(window.location.search));
      setBackDepth((d) => Math.max(0, d - 1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 페이지 본문 로드 — 캐시에 있으면 재요청하지 않는다(왕복 시 아이콘 재연결·깜빡임 방지).
  useEffect(() => {
    if (!token || !site || !effectivePageId) return;
    if (pageCacheRef.current.has(effectivePageId)) return;
    let canceled = false;
    void fetchPublicPage(token, effectivePageId)
      .then((p) => {
        if (canceled) return;
        pageCacheRef.current.set(effectivePageId, p);
        setPageCacheVersion((v) => v + 1);
      })
      .catch(() => {
        if (canceled) return;
        // 실패는 캐시에 넣지 않는다 — 다음 진입에서 재시도되도록.
        setPageCacheVersion((v) => v + 1);
      });
    return () => {
      canceled = true;
    };
  }, [token, site, effectivePageId]);

  // 렌더용 현재 페이지 — 캐시에서 파생(effectivePageId 없거나 미로드면 undefined).
  const page = effectivePageId ? pageCacheRef.current.get(effectivePageId) : undefined;
  // pageCacheVersion 은 캐시 갱신 시 재렌더 트리거(파생 page 를 최신화)하는 용도.
  void pageCacheVersion;

  const navigateTo = useCallback(
    (id: string) => {
      if (!token) return;
      const url = id === site?.rootId ? `/p/${token}` : `/p/${token}?page=${id}`;
      window.history.pushState(null, "", url);
      setCurrentPageId(id === site?.rootId ? null : id);
      setBackDepth((d) => d + 1);
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

  // 변환 결과를 pageId 로 캐시해 **동일 객체 참조**를 유지한다 — 루트로 돌아왔을 때
  // 새 doc 객체가 만들어지면 read-only 에디터가 재생성되며 인라인 아이콘이 재마운트(재연결)된다.
  const docCacheRef = useRef<Map<string, JSONContent | null>>(new Map());
  const transformedDoc = useMemo(() => {
    if (!effectivePageId || !publicDocCtx) return null;
    const cached = docCacheRef.current.get(effectivePageId);
    if (cached !== undefined) return cached;
    // 아직 이 페이지 본문이 로드되지 않았으면(파생 page 가 다른 페이지) 계산을 보류.
    if (!page || page.id !== effectivePageId) return null;
    const rawDoc = page.doc as JSONContent | null;
    const result =
      rawDoc && typeof rawDoc === "object"
        ? transformPublicDoc(rawDoc, publicDocCtx)
        : null;
    docCacheRef.current.set(effectivePageId, result);
    return result;
  }, [effectivePageId, page, publicDocCtx]);

  const outline = useMemo(
    () => extractOutlineFromDocJson(transformedDoc ?? undefined),
    [transformedDoc],
  );

  useEffect(() => {
    if (!outlineOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOutlineOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [outlineOpen]);

  const jumpToOutline = useCallback((index: number) => {
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ok = scrollPublicOutlineTargetIntoView(index, {
      behavior: prefersReducedMotion ? "auto" : "smooth",
      flash: true,
    });
    if (ok && (window.matchMedia?.("(max-width: 767px)").matches ?? false)) {
      setOutlineOpen(false);
    }
  }, []);

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
    <div className={getPublicViewerShellClassName(outlineOpen)}>
      {effectivePageId ? (
        <PublicBreadcrumbBar
          site={site}
          currentPageId={effectivePageId}
          canGoBack={backDepth > 0}
          onBack={() => window.history.back()}
          onNavigate={navigateTo}
          contentClassName={columnClass}
          renderIcon={(meta, ctx) =>
            token ? (
              <PublicPageIcon
                icon={meta.icon}
                // 아이콘 asset presign 은 "그 페이지에 참조된 자산"만 허용되므로
                // 각 crumb 자신의 pageId 컨텍스트로 요청해야 한다(현재 페이지 ctx 재사용 금지).
                ctx={{ token, pageId: ctx.pageId, publishedPageIds, pageIcons }}
                size={16}
                className=""
              />
            ) : null
          }
          actions={
            <button
              type="button"
              onClick={() => setOutlineOpen((v) => !v)}
              aria-label={outlineOpen ? "목차 닫기" : "목차 열기"}
              title={outlineOpen ? "목차 닫기" : "목차 열기"}
              aria-controls="qn-public-outline-sidebar"
              aria-expanded={outlineOpen}
              aria-pressed={outlineOpen}
              className={[
                "inline-flex h-8 w-8 items-center justify-center rounded-md border p-0 text-sm font-medium transition-colors",
                outlineOpen
                  ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              ].join(" ")}
            >
              <ListTree size={16} />
            </button>
          }
        />
      ) : null}
      <PublicOutlineSidebar
        open={outlineOpen}
        outline={outline}
        onClose={() => setOutlineOpen(false)}
        onJump={jumpToOutline}
      />
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
          <>
            <div className="px-4 md:px-12">
              <h1
                className="mb-6 flex items-center gap-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100"
                style={page.titleColor ? { color: page.titleColor } : undefined}
              >
                {publicDocCtx ? (
                  <PublicPageIcon icon={page.icon} ctx={publicDocCtx} size={32} className="" />
                ) : null}
                <span>{page.title || "제목 없음"}</span>
              </h1>
            </div>
            {transformedDoc ? (
              <EditorErrorBoundary>
                <div className="qn-public-doc">
                  <ReadOnlyDocView
                    doc={transformedDoc}
                    publishedPageIds={publishedPageIds}
                    onNavigatePublicPage={navigateTo}
                  />
                </div>
              </EditorErrorBoundary>
            ) : (
              <p className="px-4 text-sm text-zinc-400 md:px-12">내용이 없습니다.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
