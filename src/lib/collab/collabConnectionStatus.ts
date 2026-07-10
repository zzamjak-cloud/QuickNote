// QnWsProvider status + 서버 sync 여부 → 배지 표시 상태(순수 함수).
export type ProviderStatus = "connecting" | "connected" | "disconnected" | "offline" | "failed";
export type BadgeStatus = "online" | "reconnecting" | "offline";

export function toBadgeStatus(status: ProviderStatus, synced: boolean): BadgeStatus {
  // "failed"(재연결 소진) 는 오프라인 편집과 동일한 사용자 경험 — 로컬 편집만 가능.
  if (status === "offline" || status === "failed") return "offline";
  if (status === "connected" && synced) return "online";
  return "reconnecting";
}
