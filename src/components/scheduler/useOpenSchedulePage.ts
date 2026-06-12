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
    if (!parsed) return false;
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
    return true;
  }, [openPeek, showToast, workspaceId]);
}
