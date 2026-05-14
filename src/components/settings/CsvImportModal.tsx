// CSV 임직원 일괄 가져오기 모달
// 파일 선택 → 파싱 → 미리보기 → 적용

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import type { Member } from "../../store/memberStore";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useWorkspaceOptionsStore } from "../../store/workspaceOptionsStore";
import {
  parseCsvText,
  mergeMembersFromCsv,
  buildOrganizationsFromRows,
  buildTeamsFromRows,
  extractJobTitles,
  extractJobCategories,
  extractJobDetails,
  type CsvMemberRow,
} from "../../lib/parsing/csvMembers";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** memberId 기준 머지 — 새 데이터로 덮어쓰며 중복 제거 */
function mergeByMemberId(existing: Member[], incoming: Member[]): Member[] {
  const byId = new Map<string, Member>();
  for (const m of existing) byId.set(m.memberId, m);
  for (const m of incoming) byId.set(m.memberId, m);
  return Array.from(byId.values());
}

type PreviewResult = {
  rows: CsvMemberRow[];
  updatedCount: number;
  createdCount: number;
  orgCount: number;
  teamCount: number;
};

export function CsvImportModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);

  const existingMembers = useMemberStore((s) => s.members);
  const upsertMember = useMemberStore((s) => s.upsertMember);
  const upsertOrganization = useOrganizationStore((s) => s.upsertOrganization);
  const existingOrgs = useOrganizationStore((s) => s.organizations);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const existingTeams = useTeamStore((s) => s.teams);
  const setOptions = useWorkspaceOptionsStore((s) => s.setOptions);
  const currentJobTitles = useWorkspaceOptionsStore((s) => s.jobTitles);
  const currentJobCategories = useWorkspaceOptionsStore((s) => s.jobCategories);
  const currentJobDetails = useWorkspaceOptionsStore((s) => s.jobDetails);

  if (!open) return null;

  const handleFile = (file: File) => {
    setError(null);
    setPreview(null);
    setDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") return;
      try {
        const rows = parseCsvText(text);
        if (rows.length === 0) {
          setError("파싱된 행이 없습니다. CSV 형식을 확인해주세요.");
          return;
        }
        const { updated, created } = mergeMembersFromCsv(
          existingMembers,
          rows,
          () => "tmp-" + Math.random().toString(36).slice(2),
        );
        // 신규 조직·팀 수 계산
        const newOrgs = buildOrganizationsFromRows(rows).filter(
          (o) => !existingOrgs.some((e) => e.name === o.name),
        );
        const newTeams = buildTeamsFromRows(rows).filter(
          (t) => !existingTeams.some((e) => e.name === t.name),
        );
        setPreview({
          rows,
          updatedCount: updated.length,
          createdCount: created.length,
          orgCount: newOrgs.length,
          teamCount: newTeams.length,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "CSV 파싱에 실패했습니다.");
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const handleApply = () => {
    if (!preview) return;
    setApplying(true);
    try {
      const { updated, created } = mergeMembersFromCsv(
        existingMembers,
        preview.rows,
        () => "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
      );

      // 멤버 upsert
      const allFinalMembers = [...updated, ...created];
      for (const m of allFinalMembers) {
        upsertMember(m);
      }

      // 재직중·휴직·병가 멤버만 조직/팀에 자동 소속시킨다 (퇴사 제외)
      const activeMembers = allFinalMembers.filter((m) => m.employmentStatus !== "퇴사");

      // 조직(실) upsert + 소속 멤버 자동 등록
      const orgRows = buildOrganizationsFromRows(preview.rows);
      for (const org of orgRows) {
        const membersOfOrg = activeMembers.filter((m) => m.department === org.name);
        const existing = existingOrgs.find((e) => e.name === org.name);
        // 기존 조직: 기존 멤버 + 새 멤버 머지(중복 제거), 신규 조직: 새 멤버만.
        const merged = existing
          ? mergeByMemberId(existing.members, membersOfOrg)
          : membersOfOrg;
        upsertOrganization({
          ...(existing ?? org),
          members: merged,
        });
      }

      // 팀 upsert + 소속 멤버 자동 등록
      const teamRows = buildTeamsFromRows(preview.rows);
      for (const team of teamRows) {
        const membersOfTeam = activeMembers.filter((m) => m.team === team.name);
        const existing = existingTeams.find((e) => e.name === team.name);
        const merged = existing
          ? mergeByMemberId(existing.members, membersOfTeam)
          : membersOfTeam;
        upsertTeam({
          ...(existing ?? team),
          members: merged,
        });
      }

      // 직책·직무카테고리·상세직무 리스트 병합
      const newTitles = extractJobTitles(preview.rows);
      const newCats = extractJobCategories(preview.rows);
      const newDetails = extractJobDetails(preview.rows);

      const mergedTitles = [...new Set([...currentJobTitles, ...newTitles])].sort((a, b) =>
        a.localeCompare(b, "ko"),
      );
      const mergedCats = [...new Set([...currentJobCategories, ...newCats])].sort((a, b) =>
        a.localeCompare(b, "ko"),
      );
      const mergedDetails = [...new Set([...currentJobDetails, ...newDetails])].sort((a, b) =>
        a.localeCompare(b, "ko"),
      );

      setOptions({
        jobTitles: mergedTitles,
        jobCategories: mergedCats,
        jobDetails: mergedDetails,
      });

      setDone(true);
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    setPreview(null);
    setError(null);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h4 className="text-sm font-semibold">임직원 CSV 가져오기</h4>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 안내 */}
          <p className="text-xs text-zinc-500">
            헤더: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">No,상태,성명,사번,Email(ID@),소속(실),소속(팀),직책,직무,상세직무,입사일</code>
          </p>

          {/* 파일 선택 */}
          {!done && (
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-xs text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={20} className="text-zinc-400" />
              <span>CSV 파일 클릭하여 선택</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}

          {/* 오류 */}
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </p>
          )}

          {/* 미리보기 */}
          {preview && !done && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 space-y-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
              <div className="font-semibold text-zinc-700 dark:text-zinc-200">적용 예정 내역</div>
              <div className="text-zinc-600 dark:text-zinc-300">
                · 전체 파싱: <strong>{preview.rows.length}</strong>명
              </div>
              <div className="text-zinc-600 dark:text-zinc-300">
                · 기존 멤버 업데이트: <strong>{preview.updatedCount}</strong>명
              </div>
              <div className="text-zinc-600 dark:text-zinc-300">
                · 신규 멤버 추가: <strong>{preview.createdCount}</strong>명
              </div>
              <div className="text-zinc-600 dark:text-zinc-300">
                · 신규 조직(실) 생성: <strong>{preview.orgCount}</strong>개
              </div>
              <div className="text-zinc-600 dark:text-zinc-300">
                · 신규 팀 생성: <strong>{preview.teamCount}</strong>개
              </div>
            </div>
          )}

          {/* 완료 메시지 */}
          {done && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              가져오기 완료. 구성원·조직·팀·직무 목록이 업데이트되었습니다.
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {preview && !done ? (
            <button
              type="button"
              onClick={handleReset}
              className="rounded border px-3 py-1 text-xs"
            >
              다시 선택
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-xs">
              {done ? "닫기" : "취소"}
            </button>
            {preview && !done && (
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {applying ? "적용 중..." : "적용"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
