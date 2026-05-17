import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appsyncClient } from "../lib/sync/graphql/client";
import {
  LIST_MM_ENTRIES,
  LIST_MM_REVISIONS,
  LOCK_MM_ENTRY,
  REVIEW_MM_ENTRY,
  UNLOCK_MM_ENTRY,
  UPSERT_MM_ENTRY,
  type GqlMmEntry,
  type GqlMmRevision,
} from "../lib/sync/graphql/operations";
import type { MmAutoReason, MmBucket, MmEntry, MmEntryInput, MmRevision } from "../lib/scheduler/mm/mmTypes";

type SchedulerMmStore = {
  entries: MmEntry[];
  revisionsByEntryId: Record<string, MmRevision[]>;
  loading: boolean;
  fetchEntries: (args: {
    workspaceId: string;
    fromWeekStart: string;
    toWeekStart: string;
    memberId?: string | null;
  }) => Promise<void>;
  upsertEntry: (input: MmEntryInput) => Promise<MmEntry>;
  reviewEntry: (input: { workspaceId: string; entryId: string; buckets?: MmBucket[]; note?: string | null }) => Promise<MmEntry>;
  lockEntry: (workspaceId: string, entryId: string, note?: string | null) => Promise<MmEntry>;
  unlockEntry: (workspaceId: string, entryId: string, note?: string | null) => Promise<MmEntry>;
  fetchRevisions: (workspaceId: string, entryId: string) => Promise<void>;
  applyRemote: (entry: MmEntry) => void;
  getEntry: (memberId: string, weekStart: string) => MmEntry | undefined;
};

function entryId(workspaceId: string, memberId: string, weekStart: string): string {
  return `mm:${workspaceId}:${memberId}:${weekStart}`;
}

function normalizeStatus(status: GqlMmEntry["status"]): MmEntry["status"] {
  const s = String(status).toLowerCase();
  if (s === "draft" || s === "reviewed" || s === "locked") return s;
  return "submitted";
}

function normalizeKind(kind: string): MmBucket["kind"] {
  const k = kind.toLowerCase();
  if (k === "organization" || k === "team" || k === "project") return k;
  return "other";
}

function normalizeEntry(entry: GqlMmEntry): MmEntry {
  return {
    ...entry,
    status: normalizeStatus(entry.status),
    buckets: entry.buckets.map((bucket) => ({
      ...bucket,
      kind: normalizeKind(bucket.kind),
      reasons: (bucket.reasons ?? []).map((reason) => ({
        ...reason,
        type: reason.type.toLowerCase() as MmAutoReason["type"],
      })),
    })),
  };
}

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

function upsertLocal(entries: MmEntry[], entry: MmEntry): MmEntry[] {
  const exists = entries.some((item) => item.id === entry.id);
  return exists
    ? entries.map((item) => (item.id === entry.id ? entry : item))
    : [...entries, entry];
}

export const useSchedulerMmStore = create<SchedulerMmStore>()(
  persist(
    (set, get) => ({
      entries: [],
      revisionsByEntryId: {},
      loading: false,

      fetchEntries: async ({ workspaceId, fromWeekStart, toWeekStart, memberId }) => {
        set({ loading: true });
        try {
          const r = await (appsyncClient().graphql({
            query: LIST_MM_ENTRIES,
            variables: { workspaceId, fromWeekStart, toWeekStart, memberId: memberId ?? null },
          }) as Promise<{ data: { listMmEntries: GqlMmEntry[] } }>);
          const incoming = r.data.listMmEntries.map(normalizeEntry);
          set((state) => {
            const incomingIds = new Set(incoming.map((entry) => entry.id));
            const kept = state.entries.filter((entry) => {
              if (entry.workspaceId !== workspaceId) return true;
              if (memberId && entry.memberId !== memberId) return true;
              const inRange = entry.weekStart >= fromWeekStart && entry.weekStart <= toWeekStart;
              return !inRange || incomingIds.has(entry.id);
            });
            return { entries: [...kept.filter((entry) => !incomingIds.has(entry.id)), ...incoming], loading: false };
          });
        } finally {
          set({ loading: false });
        }
      },

      upsertEntry: async (input) => {
        const now = new Date().toISOString();
        const optimistic: MmEntry = {
          id: entryId(input.workspaceId, input.memberId, input.weekStart),
          workspaceId: input.workspaceId,
          memberId: input.memberId,
          weekStart: input.weekStart,
          weekEnd: input.weekEnd,
          status: "submitted",
          buckets: input.buckets,
          sourceSnapshot: input.sourceSnapshot,
          organizationId: input.organizationId ?? null,
          teamId: input.teamId ?? null,
          submittedByMemberId: "",
          submittedAt: now,
          updatedAt: now,
          note: input.note ?? null,
        };
        set((state) => ({ entries: upsertLocal(state.entries, optimistic) }));
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
        const entry = normalizeEntry(r.data.upsertMmEntry);
        set((state) => ({ entries: upsertLocal(state.entries, entry) }));
        return entry;
      },

      reviewEntry: async (input) => {
        const r = await (appsyncClient().graphql({
          query: REVIEW_MM_ENTRY,
          variables: {
            input: {
              ...input,
              buckets: input.buckets?.map(bucketToInput) ?? null,
            },
          },
        }) as Promise<{ data: { reviewMmEntry: GqlMmEntry } }>);
        const entry = normalizeEntry(r.data.reviewMmEntry);
        set((state) => ({ entries: upsertLocal(state.entries, entry) }));
        return entry;
      },

      lockEntry: async (workspaceId, entryIdValue, note) => {
        const r = await (appsyncClient().graphql({
          query: LOCK_MM_ENTRY,
          variables: { workspaceId, entryId: entryIdValue, note: note ?? null },
        }) as Promise<{ data: { lockMmEntry: GqlMmEntry } }>);
        const entry = normalizeEntry(r.data.lockMmEntry);
        set((state) => ({ entries: upsertLocal(state.entries, entry) }));
        return entry;
      },

      unlockEntry: async (workspaceId, entryIdValue, note) => {
        const r = await (appsyncClient().graphql({
          query: UNLOCK_MM_ENTRY,
          variables: { workspaceId, entryId: entryIdValue, note: note ?? null },
        }) as Promise<{ data: { unlockMmEntry: GqlMmEntry } }>);
        const entry = normalizeEntry(r.data.unlockMmEntry);
        set((state) => ({ entries: upsertLocal(state.entries, entry) }));
        return entry;
      },

      fetchRevisions: async (workspaceId, entryIdValue) => {
        const r = await (appsyncClient().graphql({
          query: LIST_MM_REVISIONS,
          variables: { workspaceId, entryId: entryIdValue },
        }) as Promise<{ data: { listMmRevisions: GqlMmRevision[] } }>);
        set((state) => ({
          revisionsByEntryId: {
            ...state.revisionsByEntryId,
            [entryIdValue]: r.data.listMmRevisions,
          },
        }));
      },

      applyRemote: (entry) => {
        set((state) => ({ entries: upsertLocal(state.entries, entry) }));
      },

      getEntry: (memberId, weekStart) =>
        get().entries.find((entry) => entry.memberId === memberId && entry.weekStart === weekStart),
    }),
    {
      name: "quicknote.scheduler.cache.mm.v1",
      partialize: (state) => ({
        entries: state.entries,
        revisionsByEntryId: state.revisionsByEntryId,
      }),
    },
  ),
);
