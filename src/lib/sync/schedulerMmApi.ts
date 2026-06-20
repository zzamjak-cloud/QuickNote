// LC 스케줄러 M/M(맨먼스) AppSync 호출 — store 에서 분리(5.1).
// 호출 형태는 보존(직접 graphql, outbox 비경유). 요청 shaping(bucketToInput 등)은 전송 관심사라 여기 둔다.
// store 는 이 함수를 호출하고 응답 정규화(normalizeEntry)·낙관적 캐시를 담당.
import { appsyncClient } from "./graphql/client";
import {
  LIST_MM_ENTRIES,
  LIST_MM_REVISIONS,
  LOCK_MM_ENTRY,
  REVIEW_MM_ENTRY,
  UNLOCK_MM_ENTRY,
  UPSERT_MM_ENTRY,
  type GqlMmEntry,
  type GqlMmRevision,
} from "./graphql/operations";
import type { MmBucket, MmEntryInput } from "../scheduler/mm/mmTypes";
import { runSchedulerMutation } from "./schedulerMutationResilience";

function bucketToInput(bucket: MmBucket) {
  return {
    id: bucket.id,
    kind: bucket.kind.toUpperCase(),
    scopeId: bucket.scopeId ?? null,
    label: bucket.label,
    ratioBp: bucket.ratioBp,
    editable: bucket.editable,
    reasons: (bucket.reasons ?? []).map((reason) => ({
      date: reason.date,
      type: reason.type.toUpperCase(),
      label: reason.label,
      ratioBp: reason.ratioBp,
    })),
  };
}

export async function listMmEntriesApi(args: {
  workspaceId: string;
  fromWeekStart: string;
  toWeekStart: string;
  memberId?: string | null;
}): Promise<GqlMmEntry[]> {
  const r = await (appsyncClient().graphql({
    query: LIST_MM_ENTRIES,
    variables: {
      workspaceId: args.workspaceId,
      fromWeekStart: args.fromWeekStart,
      toWeekStart: args.toWeekStart,
      memberId: args.memberId ?? null,
    },
  }) as Promise<{ data: { listMmEntries: GqlMmEntry[] } }>);
  return r.data.listMmEntries;
}

export async function upsertMmEntryApi(input: MmEntryInput): Promise<GqlMmEntry> {
  // upsert 는 id 주소지정 멱등 — 일시적 네트워크 오류 시 재시도 안전.
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: UPSERT_MM_ENTRY,
      variables: {
        input: {
          ...input,
          sourceSnapshot: JSON.stringify(input.sourceSnapshot ?? {}),
          buckets: input.buckets.map(bucketToInput),
        },
      },
    }) as Promise<{ data: { upsertMmEntry: GqlMmEntry } }>);
    return r.data.upsertMmEntry;
  }, { context: "schedulerMmApi.upsertMmEntry", retryable: true });
}

export async function reviewMmEntryApi(input: {
  workspaceId: string;
  entryId: string;
  buckets?: MmBucket[];
  note?: string | null;
}): Promise<GqlMmEntry> {
  // review/lock/unlock 은 상태 전이 — 이중 적용 위험이라 재시도 안 함(관측만).
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: REVIEW_MM_ENTRY,
      variables: {
        input: {
          ...input,
          buckets: input.buckets?.map(bucketToInput) ?? null,
        },
      },
    }) as Promise<{ data: { reviewMmEntry: GqlMmEntry } }>);
    return r.data.reviewMmEntry;
  }, { context: "schedulerMmApi.reviewMmEntry", retryable: false });
}

export async function lockMmEntryApi(
  workspaceId: string,
  entryId: string,
  note?: string | null,
): Promise<GqlMmEntry> {
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: LOCK_MM_ENTRY,
      variables: { workspaceId, entryId, note: note ?? null },
    }) as Promise<{ data: { lockMmEntry: GqlMmEntry } }>);
    return r.data.lockMmEntry;
  }, { context: "schedulerMmApi.lockMmEntry", retryable: false });
}

export async function unlockMmEntryApi(
  workspaceId: string,
  entryId: string,
  note?: string | null,
): Promise<GqlMmEntry> {
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: UNLOCK_MM_ENTRY,
      variables: { workspaceId, entryId, note: note ?? null },
    }) as Promise<{ data: { unlockMmEntry: GqlMmEntry } }>);
    return r.data.unlockMmEntry;
  }, { context: "schedulerMmApi.unlockMmEntry", retryable: false });
}

export async function listMmRevisionsApi(
  workspaceId: string,
  entryId: string,
): Promise<GqlMmRevision[]> {
  const r = await (appsyncClient().graphql({
    query: LIST_MM_REVISIONS,
    variables: { workspaceId, entryId },
  }) as Promise<{ data: { listMmRevisions: GqlMmRevision[] } }>);
  return r.data.listMmRevisions;
}
