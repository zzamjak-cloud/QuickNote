import type { FavoritePageMeta } from "../../store/settingsStore";
import type { WorkspaceSummary } from "../../store/workspaceStore";

export function getRevokedFavoritePageIds(
  favoritePageIds: readonly string[],
  favoritePageMetaById: Record<string, FavoritePageMeta>,
  workspaces: readonly WorkspaceSummary[],
): string[] {
  if (workspaces.length === 0) return [];
  const workspaceSet = new Set(workspaces.map((ws) => ws.workspaceId));
  return favoritePageIds.filter((pageId) => {
    const wsId = favoritePageMetaById[pageId]?.workspaceId;
    return !!wsId && !workspaceSet.has(wsId);
  });
}
