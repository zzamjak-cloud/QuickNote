export const MM_RATIO_TOTAL_BP = 10_000;
export const MM_WORKDAY_RATIO_BP = 2_000;

export type MmScopeKind = "organization" | "team" | "project" | "other";
export type MmEntryStatus = "draft" | "submitted" | "reviewed" | "locked";
export type MmAutoReasonType = "holiday" | "leave" | "empty" | "unclassified";

export type MmAutoReason = {
  date: string;
  type: MmAutoReasonType;
  label: string;
  ratioBp: number;
};

export type MmBucket = {
  id: string;
  kind: MmScopeKind;
  scopeId?: string | null;
  label: string;
  ratioBp: number;
  editable: boolean;
  reasons?: MmAutoReason[];
};

export type MmEntry = {
  id: string;
  workspaceId: string;
  memberId: string;
  weekStart: string;
  weekEnd: string;
  status: MmEntryStatus;
  buckets: MmBucket[];
  sourceSnapshot?: unknown;
  organizationId?: string | null;
  teamId?: string | null;
  submittedByMemberId: string;
  submittedAt: string;
  updatedAt: string;
  reviewedByMemberId?: string | null;
  reviewedAt?: string | null;
  lockedByMemberId?: string | null;
  lockedAt?: string | null;
  note?: string | null;
};

export type MmEntryInput = {
  workspaceId: string;
  memberId: string;
  weekStart: string;
  weekEnd: string;
  buckets: MmBucket[];
  sourceSnapshot?: unknown;
  organizationId?: string | null;
  teamId?: string | null;
  note?: string | null;
};

export type MmRevision = {
  id: string;
  entryId: string;
  workspaceId: string;
  memberId: string;
  weekStart: string;
  actorMemberId: string;
  action: "submit" | "review" | "lock" | "unlock";
  before?: unknown;
  after?: unknown;
  createdAt: string;
  note?: string | null;
};

export type MmSubmissionTone = "danger" | "success" | "neutral";

export type MmSubmissionState = {
  memberId: string;
  label: "누락" | "제출완료";
  tone: MmSubmissionTone;
  entry?: MmEntry;
};
