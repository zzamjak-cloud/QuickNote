type Args = {
  currentWorkspaceId: string | null;
  pageMetaLoading: boolean;
  pageMetaNextToken: string | null | undefined;
  tabDatabaseId: string | null;
  tabDatabasePageId: string | null;
  tabDatabaseTitle: string | null;
  workspaceBootstrapping: boolean;
  isProtectedDatabase: boolean;
};

/**
 * 풀페이지 DB 홈 페이지 auto-ensure 허용 여부를 계산한다.
 *
 * ghost 회귀를 막기 위해, DB 메타와 페이지 메타 구조 캐시가 모두 안정화된 뒤에만
 * 누락된 fullPage 홈 문서를 자동 생성한다.
 */
export function shouldAutoEnsureFullPageDatabaseHome(args: Args): boolean {
  if (!args.tabDatabaseId || args.tabDatabasePageId || args.tabDatabaseTitle == null) return false;
  if (args.isProtectedDatabase) return false;
  if (args.workspaceBootstrapping) return false;
  if (!args.currentWorkspaceId) return false;
  if (args.pageMetaLoading) return false;
  if (args.pageMetaNextToken !== null) return false;
  return true;
}
