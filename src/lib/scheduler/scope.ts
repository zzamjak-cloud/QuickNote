export const LC_SCHEDULER_WORKSPACE_ID = "lc-scheduler-global";
export const LC_SCHEDULER_WORKSPACE_NAME = "LC 스케줄러";

// LC 스케줄러는 단일 공용 워크스페이스를 사용한다.
export function resolveLCSchedulerWorkspaceId(_workspaceId?: string | null): string {
  return LC_SCHEDULER_WORKSPACE_ID;
}
