// 게시 루트의 자손 트리 계산 — 워크스페이스 페이지 메타를 GSI(byWorkspaceAndUpdatedAt)로
// 전량 로드한 뒤 parentId 기준 BFS. 순환 데이터 방어(visited)와 노드·쿼리 상한이 필수다.
// (클라이언트 isDescendant 는 순환 가드가 없으므로 그대로 이식하지 말 것.)

import {
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export type PublicPageMeta = {
  id: string;
  title: string;
  titleColor: string | null;
  icon: string | null;
  parentId: string | null;
  order: number;
  updatedAt: string | null;
};

// GSI 페이지네이션 루프 상한 — listPageMetas 의 PAGE_META_INTERNAL_QUERY_MAX 선례.
const TREE_QUERY_MAX = 40;
// 게시 트리 노드 상한 — 초과분은 잘라낸다(순환·비정상 데이터에서 무한 확장 방지).
export const TREE_NODE_MAX = 5000;

/** 워크스페이스의 공개 가능 페이지 메타 전량 로드(삭제·DB 행 페이지 제외). */
export async function loadPublishablePageMetas(
  doc: DynamoDBDocumentClient,
  pagesTable: string,
  workspaceId: string,
): Promise<Map<string, PublicPageMeta>> {
  const out = new Map<string, PublicPageMeta>();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let queryCount = 0;
  do {
    const r = await doc.send(
      new QueryCommand({
        TableName: pagesTable,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ProjectionExpression:
          "id, title, titleColor, icon, parentId, #order, databaseId, updatedAt, deletedAt",
        ExpressionAttributeNames: { "#order": "order" },
        ExpressionAttributeValues: { ":w": workspaceId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of r.Items ?? []) {
      const rec = item as Record<string, unknown>;
      // 삭제된 페이지·DB 행 페이지는 공개 대상이 아니다.
      if (rec.deletedAt) continue;
      const databaseId = rec.databaseId;
      if (databaseId != null && databaseId !== "") continue;
      const id = typeof rec.id === "string" ? rec.id : null;
      if (!id) continue;
      out.set(id, {
        id,
        title: typeof rec.title === "string" ? rec.title : "",
        titleColor: (rec.titleColor as string | null | undefined) ?? null,
        icon: (rec.icon as string | null | undefined) ?? null,
        parentId: (rec.parentId as string | null | undefined) ?? null,
        order: typeof rec.order === "number" ? rec.order : 0,
        updatedAt: (rec.updatedAt as string | null | undefined) ?? null,
      });
    }
    exclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    queryCount += 1;
  } while (exclusiveStartKey && queryCount < TREE_QUERY_MAX);
  // 메타 전용 projection 이라 40 쿼리면 수만~수십만 페이지를 덮지만, 그 이상 규모에서
  // 잘리면 깊은 자손이 트리에서 누락될 수 있으므로 조용히 넘기지 않고 경고를 남긴다.
  if (exclusiveStartKey) {
    console.warn(
      `public-view tree truncated at TREE_QUERY_MAX=${TREE_QUERY_MAX} for workspace ${workspaceId} (loaded ${out.size} metas)`,
    );
  }
  return out;
}

/** 루트 + 모든 자손 id 집합(BFS, visited 가드, 노드 상한). */
export function collectSubtreeIds(
  metas: Map<string, PublicPageMeta>,
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const meta of metas.values()) {
    if (!meta.parentId) continue;
    const list = childrenByParent.get(meta.parentId) ?? [];
    list.push(meta.id);
    childrenByParent.set(meta.parentId, list);
  }
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0 && visited.size < TREE_NODE_MAX) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }
  return visited;
}
