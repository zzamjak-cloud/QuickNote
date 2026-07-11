// 공개 뷰어 상단 네비게이션 바 — 이전 화면 가기 + 게시 루트부터의 경로(브레드크럼).
// 공개 웹은 좌측 트리가 없어 하위 페이지로 들어가면 루트로 돌아갈 수단이
// 브라우저 뒤로가기뿐이므로, 경로 각 단계를 클릭 이동 가능하게 노출한다.
import { useMemo } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { PublicPageMeta, PublicSite } from "../../lib/publicView/api";
import type { PublicDocContext } from "../../lib/publicView/transformPublicDoc";

// parentId 체인 상한 — 순환/비정상 데이터에서 무한 루프 방지(서버 BFS visited 가드와 동일 취지).
const BREADCRUMB_MAX_DEPTH = 100;
// 이 길이를 넘으면 가운데를 "…" 로 접는다(루트/현재 주변 맥락만 유지).
const BREADCRUMB_COLLAPSE_AT = 4;

/** 게시 루트 → 현재 페이지 경로. 트리 밖/순환이면 도달 가능한 구간까지만 반환한다. */
export function buildPublicBreadcrumb(
  site: PublicSite,
  pageId: string,
): PublicPageMeta[] {
  const byId = new Map(site.pages.map((p) => [p.id, p]));
  const path: PublicPageMeta[] = [];
  const visited = new Set<string>();
  let cur: string | null = pageId;
  while (cur && !visited.has(cur) && path.length < BREADCRUMB_MAX_DEPTH) {
    visited.add(cur);
    const meta = byId.get(cur);
    if (!meta) break;
    path.push(meta);
    if (cur === site.rootId) break;
    cur = meta.parentId;
  }
  return path.reverse();
}

type CrumbEntry = PublicPageMeta | { id: "__ellipsis__" };

function collapseCrumbs(path: PublicPageMeta[]): CrumbEntry[] {
  if (path.length <= BREADCRUMB_COLLAPSE_AT) return path;
  // 루트 / … / 부모 / 현재 — 깊은 계층에서도 바가 한 줄을 유지한다.
  return [path[0], { id: "__ellipsis__" }, path[path.length - 2], path[path.length - 1]];
}

export function PublicBreadcrumbBar({
  site,
  currentPageId,
  canGoBack,
  onBack,
  onNavigate,
  renderIcon,
}: {
  site: PublicSite;
  currentPageId: string;
  /** 뷰어 내 탐색 이력이 있어 브라우저 뒤로가기가 사이트 안에 머무는지. */
  canGoBack: boolean;
  onBack: () => void;
  onNavigate: (pageId: string) => void;
  /** 아이콘은 페이지별 공개 asset URL 컨텍스트가 필요해 뷰어가 렌더러를 주입한다. */
  renderIcon: (meta: PublicPageMeta, ctx: Pick<PublicDocContext, "pageId">) => React.ReactNode;
}) {
  const crumbs = useMemo(
    () => collapseCrumbs(buildPublicBreadcrumb(site, currentPageId)),
    [site, currentPageId],
  );
  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="페이지 경로"
      className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      <div className="mx-auto flex h-11 max-w-5xl items-center gap-1 px-3 md:px-6">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="이전 화면으로 가기"
          title="이전 화면으로 가기"
          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-default disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ArrowLeft size={16} />
        </button>
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            if (!("title" in crumb)) {
              return (
                <li key={`ellipsis-${i}`} className="flex items-center gap-1 text-zinc-400">
                  <span className="px-1">…</span>
                  <ChevronRight size={13} className="shrink-0" />
                </li>
              );
            }
            return (
              <li key={crumb.id} className="flex min-w-0 items-center gap-1">
                {isLast ? (
                  <span
                    aria-current="page"
                    className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-zinc-900 dark:text-zinc-100"
                  >
                    {renderIcon(crumb, { pageId: crumb.id })}
                    <span className="max-w-[14rem] truncate">{crumb.title || "제목 없음"}</span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigate(crumb.id)}
                      className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      {renderIcon(crumb, { pageId: crumb.id })}
                      <span className="max-w-[10rem] truncate">{crumb.title || "제목 없음"}</span>
                    </button>
                    <ChevronRight size={13} className="shrink-0 text-zinc-400" />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
