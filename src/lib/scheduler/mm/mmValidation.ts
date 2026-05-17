import {
  MM_RATIO_TOTAL_BP,
  type MmBucket,
  type MmEntry,
  type MmSubmissionState,
} from "./mmTypes";

export type MmValidationResult = {
  ok: boolean;
  totalBp: number;
  message?: string;
};

export function clampRatioBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MM_RATIO_TOTAL_BP, Math.round(value)));
}

export function percentToBp(value: number): number {
  return clampRatioBp(value * 100);
}

export function bpToPercent(value: number): number {
  return Math.round((value / 100) * 100) / 100;
}

export function validateMmBuckets(buckets: MmBucket[]): MmValidationResult {
  const totalBp = buckets.reduce((sum, bucket) => sum + clampRatioBp(bucket.ratioBp), 0);
  if (buckets.some((bucket) => bucket.ratioBp < 0 || bucket.ratioBp > MM_RATIO_TOTAL_BP)) {
    return { ok: false, totalBp, message: "MM 비율은 0% 이상 100% 이하로 입력해야 합니다." };
  }
  if (totalBp !== MM_RATIO_TOTAL_BP) {
    return { ok: false, totalBp, message: "주간 MM 합계가 100%가 되어야 합니다." };
  }
  return { ok: true, totalBp };
}

export function toCsvMmValue(ratioBp: number): string {
  const normalized = clampRatioBp(ratioBp) / MM_RATIO_TOTAL_BP;
  return Number(normalized.toFixed(4)).toString();
}

export function getMemberSubmissionStates(
  members: Array<{ memberId: string }>,
  entries: MmEntry[],
  weekStart: string,
): MmSubmissionState[] {
  const byMember = new Map(
    entries
      .filter((entry) => entry.weekStart === weekStart)
      .map((entry) => [entry.memberId, entry]),
  );
  return members.map((member) => {
    const entry = byMember.get(member.memberId);
    const submitted = Boolean(entry && entry.status !== "draft");
    return {
      memberId: member.memberId,
      label: submitted ? "제출완료" : "누락",
      tone: submitted ? "success" : "danger",
      entry,
    };
  });
}
