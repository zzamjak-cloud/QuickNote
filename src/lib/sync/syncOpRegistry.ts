// 동기화 op 단일 등록점 — OutboxOp 별 엔티티 배선(실행/삭제판정/supersede/tombstone)을 한 곳에 모은다.
// 새 동기화 엔티티/op 추가 시 이 레지스트리 한 곳만 수정하면 SyncEngine 의 분기들이 따라온다.
// 주의: flush/retry/백오프 등 엔진 핫로직은 engine.ts 에 그대로 둔다. 여기서는 "어떤 op 가 무엇을 하는가"의 메타만 다룬다.
import { isLCSchedulerDatabaseId } from "../scheduler/database";
import type { OutboxEntityType, OutboxOp } from "./outbox/types";

// AppSync 호출 어댑터 계약 — bridge.ts 의 realGqlBridge 가 구현, SyncEngine 에 주입된다.
export interface GqlBridge {
  upsertPage(input: unknown): Promise<void>;
  upsertDatabase(input: unknown): Promise<void>;
  softDeletePage(id: string, workspaceId: string, updatedAt: string): Promise<void>;
  softDeleteDatabase(id: string, workspaceId: string, updatedAt: string): Promise<void>;
  /** 멤버 본인 clientPrefs(즐겨찾기 등) 동기화. */
  updateMyClientPrefs(clientPrefsJson: string): Promise<void>;
  upsertComment(input: unknown): Promise<void>;
  softDeleteComment(id: string, workspaceId: string, updatedAt: string): Promise<void>;
}

export type EnqueuePayload = {
  id: string;
  workspaceId?: string;
  updatedAt?: string;
  /** updateMyClientPrefs 전용(JSON 문자열) */
  clientPrefs?: string;
};

function normalizeClientPrefsJsonForServer(json: string): string {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (Number(parsed.v) === 2) {
      return JSON.stringify({ ...parsed, v: 1 });
    }
  } catch {
    return json;
  }
  return json;
}

export type SyncOpSpec = {
  /** outbox 엔트리 분류(플러시·관측용). */
  entityType: OutboxEntityType;
  /** soft delete op 인지. */
  isDelete: boolean;
  /** delete op 가 무력화(supersede)해야 할 대응 upsert op. delete 가 아니면 null. */
  supersededUpsertOp: OutboxOp | null;
  /** 서버에서도 사라짐이 확정될 때 영구 tombstone 가드를 심을 엔티티. 미지원이면 null. */
  tombstoneEntity: "page" | "database" | null;
  /** 실제 AppSync mutation 실행. */
  execute: (gql: GqlBridge, payload: EnqueuePayload) => Promise<void>;
};

export const SYNC_OP_REGISTRY: Record<OutboxOp, SyncOpSpec> = {
  upsertPage: {
    entityType: "page",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    execute: (gql, p) => gql.upsertPage(p),
  },
  upsertDatabase: {
    entityType: "database",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    execute: (gql, p) => gql.upsertDatabase(p),
  },
  softDeletePage: {
    entityType: "page",
    isDelete: true,
    supersededUpsertOp: "upsertPage",
    tombstoneEntity: "page",
    execute: (gql, p) => gql.softDeletePage(p.id, p.workspaceId ?? "", p.updatedAt ?? ""),
  },
  softDeleteDatabase: {
    entityType: "database",
    isDelete: true,
    supersededUpsertOp: "upsertDatabase",
    tombstoneEntity: "database",
    execute: (gql, p) => {
      if (isLCSchedulerDatabaseId(p.id)) return Promise.resolve();
      return gql.softDeleteDatabase(p.id, p.workspaceId ?? "", p.updatedAt ?? "");
    },
  },
  upsertComment: {
    entityType: "comment",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    execute: (gql, p) => gql.upsertComment(p),
  },
  softDeleteComment: {
    // comment 는 별도 tombstone 가드 시스템이 없으므로 tombstoneEntity 는 null.
    entityType: "comment",
    isDelete: true,
    supersededUpsertOp: "upsertComment",
    tombstoneEntity: null,
    execute: (gql, p) => gql.softDeleteComment(p.id, p.workspaceId ?? "", p.updatedAt ?? ""),
  },
  updateMyClientPrefs: {
    entityType: "memberPrefs",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    execute: (gql, p) => {
      const json = (p as { clientPrefs?: string }).clientPrefs;
      if (typeof json !== "string" || !json) {
        throw new Error("updateMyClientPrefs: clientPrefs 문자열 누락");
      }
      return gql.updateMyClientPrefs(normalizeClientPrefsJsonForServer(json));
    },
  },
};

export function isDeleteOp(op: OutboxOp): boolean {
  return SYNC_OP_REGISTRY[op].isDelete;
}

export function supersededUpsertOpForDelete(op: OutboxOp): OutboxOp | null {
  return SYNC_OP_REGISTRY[op].supersededUpsertOp;
}
