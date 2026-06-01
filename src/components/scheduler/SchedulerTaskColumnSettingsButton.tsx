// 작업 탭(연/월/주) 헤더의 표시 설정 버튼 — 마일스톤·피처 타임라인과 동일하게 작업 DB의
// viewConfigs.timeline 설정을 편집한다. 작업 DB는 삭제만 불가할 뿐 컬럼 표시 설정은 동일 규칙.
import { useDatabaseStore } from "../../store/databaseStore";
import { emptyPanelState } from "../../types/database";
import { makeLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { DatabaseColumnSettingsButton } from "../database/DatabaseColumnSettingsButton";

export function SchedulerTaskColumnSettingsButton({ workspaceId }: { workspaceId: string }) {
  const databaseId = makeLCSchedulerDatabaseId(workspaceId);
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  if (!bundle) return null;
  return (
    <DatabaseColumnSettingsButton
      databaseId={databaseId}
      viewKind="timeline"
      panelState={bundle.panelState ?? emptyPanelState()}
      setPanelState={(patch) => patchDatabasePanelState(databaseId, patch)}
      // LC 스케줄러 모달(z-[500]) 내부라 팝오버가 뒤로 숨지 않도록 그 위 z-index 사용.
      popoverZClassName="z-[560]"
    />
  );
}
