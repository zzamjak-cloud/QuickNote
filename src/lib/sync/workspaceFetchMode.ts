export type WorkspaceRemoteFetchMode =
  | { kind: "delta"; updatedAfter: string; reason: "cache-watermark" }
  | { kind: "full"; updatedAfter?: undefined; reason: string };

type ResolveWorkspaceRemoteFetchModeArgs = {
  cacheAvailable: boolean;
  switchCleared: boolean;
  switchReason: string;
  watermark?: string;
};

const FULL_FETCH_SWITCH_REASONS = new Set([
  "deferred-switch",
  "pending-outbox",
  "initial-cache-mismatch",
  "switched",
]);

export function resolveWorkspaceRemoteFetchMode({
  cacheAvailable,
  switchCleared,
  switchReason,
  watermark,
}: ResolveWorkspaceRemoteFetchModeArgs): WorkspaceRemoteFetchMode {
  if (!cacheAvailable) {
    return { kind: "full", reason: "no-cache" };
  }
  if (!watermark) {
    return { kind: "full", reason: "no-watermark" };
  }
  if (switchCleared) {
    return { kind: "full", reason: "cache-cleared" };
  }
  if (FULL_FETCH_SWITCH_REASONS.has(switchReason)) {
    return { kind: "full", reason: switchReason };
  }
  return { kind: "delta", updatedAfter: watermark, reason: "cache-watermark" };
}
