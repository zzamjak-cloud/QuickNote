// /p/<token> 공개 페이지 뷰어 — 비로그인 읽기 전용.
// AuthGate·useSyncBootstrap·zustand 부트스트랩을 전혀 타지 않는다(Bootstrap 에서 분기).
// 렌더는 BlockDiffView 의 ReadOnlyBlocksPane 레시피(store 비의존 read-only TipTap)를 재사용한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { useEditorExtensions } from "../editor/useEditorExtensions";
import { EditorErrorBoundary } from "../editor/EditorErrorBoundary";
import {
  fetchPublicPage,
  fetchPublicSite,
  isPublicViewConfigured,
  type PublicPage,
  type PublicPageMeta,
  type PublicSite,
} from "../../lib/publicView/api";
import {
  transformPublicDoc,
  toPublicAssetUrl,
} from "../../lib/publicView/transformPublicDoc";

/** /p/<token> 에서 토큰 추출(쿼리·해시 제외) */
function parseTokenFromPath(pathname: string): string | null {
  const m = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

function parsePageIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("page");
  return id && id.length > 0 ? id : null;
}

/** 커스텀 이미지 아이콘(quicknote-image://)은 공개 뷰어에서 생략하고 이모지만 표시 */
function EmojiIcon({ icon }: { icon: string | null }) {
  if (!icon || icon.startsWith("quicknote-")) return null;
  return <span className="mr-1.5">{icon}</span>;
}

function ReadOnlyDocView({ doc }: { doc: JSONContent }) {
  const extensions = useEditorExtensions({
    lowlightApi: null,
    isFullPageDatabase: false,
    effectivePageId: null,
    myMemberId: undefined,
    collabDoc: null,
    collabAwareness: null,
  });
  const editor = useEditor({ extensions, content: doc, editable: false }, [doc]);
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

type TreeNode = PublicPageMeta & { children: TreeNode[] };

function buildTree(pages: PublicPageMeta[], rootId: string): TreeNode | null {
  const byId = new Map<string, TreeNode>(
    pages.map((p) => [p.id, { ...p, children: [] }]),
  );
  for (const node of byId.values()) {
    if (!node.parentId || node.id === rootId) continue;
    byId.get(node.parentId)?.children.push(node);
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.order - b.order);
  }
  return byId.get(rootId) ?? null;
}

function TreeList({
  nodes,
  depth,
  currentId,
  onNavigate,
}: {
  nodes: TreeNode[];
  depth: number;
  currentId: string;
  onNavigate: (id: string) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => onNavigate(node.id)}
            className={[
              "flex w-full items-center truncate rounded-md px-2 py-1 text-left text-sm",
              node.id === currentId
                ? "bg-zinc-200/80 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60",
            ].join(" ")}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <EmojiIcon icon={node.icon} />
            <span className="truncate">{node.title || "제목 없음"}</span>
          </button>
          <TreeList
            nodes={node.children}
            depth={depth + 1}
            currentId={currentId}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );
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

  const transformedDoc = useMemo(() => {
    if (!page || !token || !effectivePageId) return null;
    const rawDoc = page.doc as JSONContent | null;
    if (!rawDoc || typeof rawDoc !== "object") return null;
    return transformPublicDoc(rawDoc, {
      token,
      pageId: effectivePageId,
      publishedPageIds,
    });
  }, [page, token, effectivePageId, publishedPageIds]);

  if (!token) {
    return <CenteredNotice title="잘못된 링크입니다." />;
  }
  if (site === undefined) {
    return <CenteredNotice title="불러오는 중…" />;
  }
  if (site === null) {
    return (
      <CenteredNotice
        title="페이지를 찾을 수 없습니다."
        detail="게시가 해제되었거나 존재하지 않는 페이지입니다."
      />
    );
  }

  const tree = buildTree(site.pages, site.rootId);
  const coverSrc =
    page && token && effectivePageId
      ? toPublicAssetUrl(page.coverImage, {
          token,
          pageId: effectivePageId,
          publishedPageIds,
        })
      : null;
  const hasChildren = (tree?.children.length ?? 0) > 0;

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      {hasChildren && (
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-zinc-200 px-2 py-4 md:block dark:border-zinc-800">
          {tree && (
            <TreeList
              nodes={[tree]}
              depth={0}
              currentId={effectivePageId ?? site.rootId}
              onNavigate={navigateTo}
            />
          )}
        </aside>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            className="h-48 w-full object-cover"
            draggable={false}
          />
        )}
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          {/* 모바일: 트리 대신 상단 breadcrumb 유사 내비 */}
          {hasChildren && (
            <nav className="mb-4 flex items-center gap-1 text-xs text-zinc-500 md:hidden">
              <button type="button" onClick={() => navigateTo(site.rootId)}>
                {tree?.title || "홈"}
              </button>
              {effectivePageId !== site.rootId && (
                <>
                  <ChevronRight size={12} />
                  <span className="truncate">{page?.title ?? ""}</span>
                </>
              )}
            </nav>
          )}
          {page === undefined ? (
            <p className="text-sm text-zinc-400">불러오는 중…</p>
          ) : page === null ? (
            <p className="text-sm text-zinc-500">이 페이지는 더 이상 공개되지 않습니다.</p>
          ) : (
            <>
              <h1
                className="mb-6 text-3xl font-bold text-zinc-900 dark:text-zinc-100"
                style={page.titleColor ? { color: page.titleColor } : undefined}
              >
                <EmojiIcon icon={page.icon} />
                {page.title || "제목 없음"}
              </h1>
              {transformedDoc ? (
                <EditorErrorBoundary>
                  <div className="qn-public-doc">
                    <ReadOnlyDocView doc={transformedDoc} />
                  </div>
                </EditorErrorBoundary>
              ) : (
                <p className="text-sm text-zinc-400">내용이 없습니다.</p>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
