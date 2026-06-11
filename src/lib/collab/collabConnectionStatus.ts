// QnWsProvider status + 서버 sync 여부 → 배지 표시 상태(순수 함수).
export type ProviderStatus = "connecting" | "connected" | "disconnected" | "offline";
export type BadgeStatus = "online" | "reconnecting" | "offline";

export function toBadgeStatus(status: ProviderStatus, synced: boolean): BadgeStatus {
  if (status === "offline") return "offline";
  if (status === "connected" && synced) return "online";
  return "reconnecting";
}
