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
  toggleCommentReaction(input: unknown): Promise<void>;
  softDeleteComment(id: string, workspaceId: string, updatedAt: string): Promise<void>;
}

export type EnqueuePayload = {
  id: string;
  workspaceId?: string;
  updatedAt?: string;
  /** updateMyClientPrefs 전용(JSON 문자열) */
  clientPrefs?: string;
  /** 같은 entity id 안에서 더 좁은 단위로 dedupe 해야 할 때 사용한다. */
  dedupeId?: string;
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
  /** outbox 메타: 워크스페이스 스코프 op 인지. false 면 메타 workspaceId 를 null 로 둔다(멤버 전역 prefs). */
  workspaceScoped: boolean;
  /** outbox 메타: payload.version 을 baseVersion 으로 기록할지(낙관적 동시성용 upsert 계열만). */
  capturesBaseVersion: boolean;
  /** outbox 메타: workspaceId 누락 시 flush 범위 이탈 위험을 경고할지. */
  warnIfMissingWorkspace: boolean;
  /** 실제 AppSync mutation 실행. */
  execute: (gql: GqlBridge, payload: EnqueuePayload) => Promise<void>;
};

export const SYNC_OP_REGISTRY: Record<OutboxOp, SyncOpSpec> = {
  upsertPage: {
    entityType: "page",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    workspaceScoped: true,
    capturesBaseVersion: true,
    warnIfMissingWorkspace: false,
    execute: (gql, p) => gql.upsertPage(p),
  },
  upsertDatabase: {
    entityType: "database",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    workspaceScoped: true,
    capturesBaseVersion: true,
    warnIfMissingWorkspace: false,
    execute: (gql, p) => gql.upsertDatabase(p),
  },
  softDeletePage: {
    entityType: "page",
    isDelete: true,
    supersededUpsertOp: "upsertPage",
    tombstoneEntity: "page",
    workspaceScoped: true,
    capturesBaseVersion: false,
    warnIfMissingWorkspace: false,
    execute: (gql, p) => gql.softDeletePage(p.id, p.workspaceId ?? "", p.updatedAt ?? ""),
  },
  softDeleteDatabase: {
    entityType: "database",
    isDelete: true,
    supersededUpsertOp: "upsertDatabase",
    tombstoneEntity: "database",
    workspaceScoped: true,
    capturesBaseVersion: false,
    warnIfMissingWorkspace: false,
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
    workspaceScoped: true,
    capturesBaseVersion: true,
    // workspaceId 없는 comment 는 워크스페이스 전환 시 영영 flush 안 될 수 있으므로 경고.
    warnIfMissingWorkspace: true,
    execute: (gql, p) => gql.upsertComment(p),
  },
  toggleCommentReaction: {
    entityType: "comment",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    workspaceScoped: true,
    capturesBaseVersion: false,
    warnIfMissingWorkspace: true,
    execute: (gql, p) => gql.toggleCommentReaction(p),
  },
  softDeleteComment: {
    // comment 는 별도 tombstone 가드 시스템이 없으므로 tombstoneEntity 는 null.
    entityType: "comment",
    isDelete: true,
    supersededUpsertOp: "upsertComment",
    tombstoneEntity: null,
    workspaceScoped: true,
    capturesBaseVersion: false,
    warnIfMissingWorkspace: false,
    execute: (gql, p) => gql.softDeleteComment(p.id, p.workspaceId ?? "", p.updatedAt ?? ""),
  },
  updateMyClientPrefs: {
    entityType: "memberPrefs",
    isDelete: false,
    supersededUpsertOp: null,
    tombstoneEntity: null,
    // 멤버 전역 prefs 는 워크스페이스 비스코프 → 메타 workspaceId 는 null.
    workspaceScoped: false,
    capturesBaseVersion: false,
    warnIfMissingWorkspace: false,
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
