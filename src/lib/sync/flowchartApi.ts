// 플로우차트 공유 자원 AppSync 호출 — outbox 비경유(스케줄러 API 와 동일 형태).
// 블록이 마운트 시 fetch → store.applyRemote, 저장 시 push 한다.
import { appsyncClient } from "./graphql/client";
import {
  GET_FLOWCHART,
  UPSERT_FLOWCHART,
  LIST_FLOWCHART_HISTORY,
  SAVE_FLOWCHART_VERSION,
  type GqlFlowchart,
  type GqlFlowchartHistoryEntry,
} from "./queries/flowchart";
import {
  parseFlowchart,
  serializeFlowchart,
  type FlowchartData,
  type FlowchartRecord,
} from "../../types/flowchart";
import type { FlowchartVersion } from "../../store/flowchartHistoryStore";

function gqlToRecord(g: GqlFlowchart): FlowchartRecord {
  const updatedAt = Date.parse(g.updatedAt);
  return {
    id: g.id,
    workspaceId: g.workspaceId,
    title: typeof g.title === "string" ? g.title : "",
    data: parseFlowchart(g.data),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    deletedAt: g.deletedAt ? Date.parse(g.deletedAt) || null : null,
  };
}

/** 서버에서 단건 조회. 미배포/오류 시 null(throw 안 함) — graceful fallback. */
export async function fetchFlowchartApi(
  id: string,
  workspaceId: string,
): Promise<FlowchartRecord | null> {
  try {
    const r = (await appsyncClient().graphql({
      query: GET_FLOWCHART,
      variables: { id, workspaceId },
    })) as { data?: { getFlowchart?: GqlFlowchart | null } };
    const g = r.data?.getFlowchart;
    return g ? gqlToRecord(g) : null;
  } catch (error) {
    console.warn("[flowchart] fetch 실패(무시):", error);
    return null;
  }
}

/** 서버로 업서트. 미배포/오류 시 조용히 무시 — 로컬 store 는 이미 반영됨. */
export async function pushFlowchartApi(record: FlowchartRecord): Promise<void> {
  if (!record.workspaceId) return;
  const iso = new Date(record.updatedAt).toISOString();
  try {
    await appsyncClient().graphql({
      query: UPSERT_FLOWCHART,
      variables: {
        input: {
          id: record.id,
          workspaceId: record.workspaceId,
          title: record.title,
          data: serializeFlowchart(record.data),
          createdAt: iso,
          updatedAt: iso,
        },
      },
    });
  } catch (error) {
    console.warn("[flowchart] push 실패(무시):", error);
  }
}

function historyToVersion(g: GqlFlowchartHistoryEntry): FlowchartVersion {
  const createdAt = Date.parse(g.createdAt);
  return {
    id: g.historyId,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    title: typeof g.title === "string" ? g.title : "",
    data: parseFlowchart(g.data),
  };
}

/** 서버 버전 히스토리 조회(최신순). 미배포/오류 시 null. */
export async function listFlowchartHistoryApi(
  flowchartId: string,
  workspaceId: string,
): Promise<FlowchartVersion[] | null> {
  try {
    const r = (await appsyncClient().graphql({
      query: LIST_FLOWCHART_HISTORY,
      variables: { flowchartId, workspaceId, limit: 100 },
    })) as { data?: { listFlowchartHistory?: GqlFlowchartHistoryEntry[] } };
    const items = r.data?.listFlowchartHistory ?? [];
    return items.map(historyToVersion);
  } catch (error) {
    console.warn("[flowchart] history 조회 실패(무시):", error);
    return null;
  }
}

/** 서버에 새 버전 스냅샷 적립. 미배포/오류 시 조용히 무시. */
export async function saveFlowchartVersionApi(
  flowchartId: string,
  workspaceId: string,
  title: string,
  data: FlowchartData,
): Promise<void> {
  if (!workspaceId) return;
  try {
    await appsyncClient().graphql({
      query: SAVE_FLOWCHART_VERSION,
      variables: {
        flowchartId,
        workspaceId,
        title,
        data: serializeFlowchart(data),
      },
    });
  } catch (error) {
    console.warn("[flowchart] saveVersion 실패(무시):", error);
  }
}
