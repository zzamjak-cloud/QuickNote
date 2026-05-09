import type { OutboxEntityType, OutboxOp } from "./outbox/types";

/** outbox 행 단위 메타 — enqueue 시점에 채워 flush/디버깅 시 워크스페이스 경계 확인에 사용한다. */

export type OutboxEntryMeta = {
  /** 페이지/DB 뮤테이션은 payload.workspaceId 와 동일. 멤버 prefs 는 워크스페이스 비스코프(null). */
  workspaceId: string | null;
  entityType: OutboxEntityType;
  entityId: string;
  /** 서버 낙관적 동시성 등에 확장 가능; 현재 payload 에 version 있으면 기록한다. */
  baseVersion?: number;
};

/** payload(GraphQL input)에서 엔트리 레벨 메타를 분리한다. */
export function buildOutboxEntryMeta(
  op: OutboxOp,
  payload: Record<string, unknown>,
): OutboxEntryMeta {
  const id = typeof payload.id === "string" ? payload.id : "";
  const workspaceFromPayload =
    typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
      ? payload.workspaceId
      : null;
  const versionRaw = payload.version;
  const baseVersion =
    typeof versionRaw === "number" ? versionRaw : undefined;

  switch (op) {
    case "upsertPage":
      return {
        workspaceId: workspaceFromPayload,
        entityType: "page",
        entityId: id,
        baseVersion,
      };
    case "upsertDatabase":
      return {
        workspaceId: workspaceFromPayload,
        entityType: "database",
        entityId: id,
        baseVersion,
      };
    case "softDeletePage":
      return {
        workspaceId: workspaceFromPayload,
        entityType: "page",
        entityId: id,
      };
    case "softDeleteDatabase":
      return {
        workspaceId: workspaceFromPayload,
        entityType: "database",
        entityId: id,
      };
    case "updateMyClientPrefs":
      return {
        workspaceId: null,
        entityType: "memberPrefs",
        entityId: id,
      };
  }
}
