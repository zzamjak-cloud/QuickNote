// 복제로 공유(flowchartId 동일)되던 플로우차트 블록을 현재 상태 그대로
// 새 독립 자원(새 flowchartId)으로 분리한다.
// 버전 히스토리는 "해제된 순간"을 버전 1로 새로 시작한다(원본 히스토리는 승계하지 않음).
import { newId } from "../id";
import {
  parseFlowchart,
  serializeFlowchart,
  type FlowchartData,
} from "../../types/flowchart";
import { useFlowchartStore, getFlowchartData } from "../../store/flowchartStore";
import { useFlowchartHistoryStore } from "../../store/flowchartHistoryStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { pushFlowchartApi, saveFlowchartVersionApi } from "../sync/flowchartApi";

/**
 * 플로우차트 블록의 동기화를 해제하고 현재 상태의 독립 복제본을 만든다.
 * @returns 새 flowchartId 와 블록 attrs 에 실을 직렬화된 스냅샷.
 */
export function unbindFlowchartSync(attrs: {
  flowchartId?: string;
  data?: string;
  title?: string;
}): { newFlowchartId: string; serializedData: string } {
  const oldId = typeof attrs.flowchartId === "string" ? attrs.flowchartId : "";
  const title = typeof attrs.title === "string" ? attrs.title : "";
  // 현재 데이터: 공유 저장소 레코드(권위) 우선, 없으면 인라인 스냅샷.
  const current: FlowchartData =
    (oldId ? getFlowchartData(oldId) : undefined) ?? parseFlowchart(attrs.data);
  const wsId = useWorkspaceStore.getState().currentWorkspaceId ?? null;

  const newFlowchartId = newId();
  // 새 독립 레코드 생성(현재 상태 복사) — 이후 이 블록만 이 id 를 구독한다.
  const record = useFlowchartStore.getState().upsertLocal({
    id: newFlowchartId,
    workspaceId: wsId,
    title,
    data: current,
  });
  // 버전 1로 히스토리 새 시작(로컬 + 서버). 새 id 라 항상 첫 버전으로 적립된다.
  useFlowchartHistoryStore.getState().pushVersion(newFlowchartId, title, current);
  void saveFlowchartVersionApi(newFlowchartId, wsId ?? "", title, current);
  // 서버에 새 자원 push(크로스 기기 반영).
  void pushFlowchartApi(record);

  return { newFlowchartId, serializedData: serializeFlowchart(current) };
}
