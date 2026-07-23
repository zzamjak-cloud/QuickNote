import type { OutboxEntityType, OutboxOp } from "./outbox/types";
import { SYNC_OP_REGISTRY } from "./syncOpRegistry";

/** outbox 행 단위 메타 — enqueue 시점에 채워 flush/디버깅 시 워크스페이스 경계 확인에 사용한다. */

export type OutboxEntryMeta = {
  /** 페이지/DB 뮤테이션은 payload.workspaceId 와 동일. 멤버 prefs 는 워크스페이스 비스코프(null). */
  workspaceId: string | null;
  entityType: OutboxEntityType;
  entityId: string;
  /** 서버 낙관적 동시성 등에 확장 가능; 현재 payload 에 version 있으면 기록한다. */
  baseVersion?: number;
};

/**
 * payload(GraphQL input)에서 엔트리 레벨 메타를 분리한다.
 * op 별 분기 대신 syncOpRegistry 단일 등록점의 메타 플래그로 구동한다
 * (새 동기화 엔티티 추가 시 레지스트리 한 곳만 수정하면 된다).
 */
export function buildOutboxEntryMeta(
  op: OutboxOp,
  payload: Record<string, unknown>,
): OutboxEntryMeta {
  const id = typeof payload.id === "string" ? payload.id : "";
  const spec = SYNC_OP_REGISTRY[op];
  const workspaceFromPayload =
    typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
      ? payload.workspaceId
      : null;

  if (spec.warnIfMissingWorkspace && !workspaceFromPayload) {
    console.warn(
      "[sync] comment outbox: workspaceId 누락 — 이 항목은 flush 범위에서 벗어날 수 있습니다.",
      { op, commentId: id },
    );
  }

  const meta: OutboxEntryMeta = {
    workspaceId: spec.workspaceScoped ? workspaceFromPayload : null,
    entityType: spec.entityType,
    entityId: id,
  };
  if (spec.capturesBaseVersion) {
    const versionRaw = payload.version;
    meta.baseVersion = typeof versionRaw === "number" ? versionRaw : undefined;
  }
  return meta;
}
