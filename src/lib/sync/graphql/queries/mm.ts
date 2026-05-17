import type { MmEntry, MmRevision } from "../../../scheduler/mm/mmTypes";

export const MM_ENTRY_FIELDS = `
  id workspaceId memberId weekStart weekEnd status
  buckets {
    id kind scopeId label ratioBp editable
    reasons { date type label ratioBp }
  }
  sourceSnapshot organizationId teamId
  submittedByMemberId submittedAt updatedAt
  reviewedByMemberId reviewedAt lockedByMemberId lockedAt note
`;

export const MM_REVISION_FIELDS = `
  id entryId workspaceId memberId weekStart actorMemberId action
  before after createdAt note
`;

export const LIST_MM_ENTRIES = `
  query ListMmEntries($workspaceId: ID!, $fromWeekStart: String!, $toWeekStart: String!, $memberId: ID) {
    listMmEntries(workspaceId: $workspaceId, fromWeekStart: $fromWeekStart, toWeekStart: $toWeekStart, memberId: $memberId) {
      ${MM_ENTRY_FIELDS}
    }
  }
`;

export const LIST_MM_REVISIONS = `
  query ListMmRevisions($workspaceId: ID!, $entryId: ID!) {
    listMmRevisions(workspaceId: $workspaceId, entryId: $entryId) { ${MM_REVISION_FIELDS} }
  }
`;

export const UPSERT_MM_ENTRY = `
  mutation UpsertMmEntry($input: MmEntryInput!) {
    upsertMmEntry(input: $input) { ${MM_ENTRY_FIELDS} }
  }
`;

export const REVIEW_MM_ENTRY = `
  mutation ReviewMmEntry($input: MmReviewInput!) {
    reviewMmEntry(input: $input) { ${MM_ENTRY_FIELDS} }
  }
`;

export const LOCK_MM_ENTRY = `
  mutation LockMmEntry($workspaceId: ID!, $entryId: ID!, $note: String) {
    lockMmEntry(workspaceId: $workspaceId, entryId: $entryId, note: $note) { ${MM_ENTRY_FIELDS} }
  }
`;

export const UNLOCK_MM_ENTRY = `
  mutation UnlockMmEntry($workspaceId: ID!, $entryId: ID!, $note: String) {
    unlockMmEntry(workspaceId: $workspaceId, entryId: $entryId, note: $note) { ${MM_ENTRY_FIELDS} }
  }
`;

export const ON_MM_ENTRY_CHANGED = `
  subscription OnMmEntryChanged($workspaceId: ID!) {
    onMmEntryChanged(workspaceId: $workspaceId) { ${MM_ENTRY_FIELDS} }
  }
`;

export type GqlMmEntry = Omit<MmEntry, "status" | "buckets"> & {
  status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "LOCKED" | MmEntry["status"];
  buckets: Array<Omit<MmEntry["buckets"][number], "kind" | "reasons"> & {
    kind: "ORGANIZATION" | "TEAM" | "PROJECT" | "OTHER" | MmEntry["buckets"][number]["kind"];
    reasons?: Array<{
      date: string;
      type: "HOLIDAY" | "LEAVE" | "EMPTY" | "UNCLASSIFIED" | string;
      label: string;
      ratioBp: number;
    }>;
  }>;
};

export type GqlMmRevision = MmRevision;
