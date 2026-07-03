import { useCallback } from "react";
import { parseScheduleInstanceId } from "../../lib/scheduler/taskAdapter";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { ensurePageContentLoaded } from "../../lib/sync/pageContentLoad";
import { useUiStore } from "../../store/uiStore";

export function useOpenSchedulePage(workspaceId = LC_SCHEDULER_WORKSPACE_ID) {
  const openPeek = useUiStore((s) => s.openPeek);
  const showToast = useUiStore((s) => s.showToast);

  return useCallback(async (scheduleId: string) => {
    const parsed = parseScheduleInstanceId(scheduleId);
    if (!parsed) {
      // ⚠️ 임시 계측 — 실기기 더블탭 디버그용. 원인 확정 후 제거.
      showToast("[더블탭] 일정 ID 파싱 실패", { kind: "error" });
      return false;
    }
    const loaded = await ensurePageContentLoaded({
      pageId: parsed.pageId,
      workspaceId,
      source: "lc-scheduler-schedule-open",
    });
    if (!loaded) {
      showToast("일정 페이지를 불러오지 못했습니다.", { kind: "error" });
      return false;
    }
    openPeek(parsed.pageId);
    // ⚠️ 임시 계측 — 실기기 더블탭 디버그용. 원인 확정 후 제거.
    showToast(`[더블탭] 피크 오픈 호출됨: ${parsed.pageId.slice(0, 8)}`, { kind: "success" });
    return true;
  }, [openPeek, showToast, workspaceId]);
}
