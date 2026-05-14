// CSV 임직원 일괄 가져오기 모달
// 파일 선택 → 파싱 → 미리보기 → AppSync 순차 적용
// 팀: AppSync createTeam + assignMemberToTeam
// 조직(실): AppSync createOrganization + assignMemberToOrganization

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import type { Member } from "../../store/memberStore";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import type { Organization } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import type { Team } from "../../store/teamStore";
import { useWorkspaceOptionsStore } from "../../store/workspaceOptionsStore";
import { useUiStore } from "../../store/uiStore";
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
import {
  assignMemberToTeamApi,
  createMemberApi,
  unassignMemberFromTeamApi,
  updateMemberApi,
} from "../../lib/sync/memberApi";
import { createTeamApi } from "../../lib/sync/teamApi";
import {
  assignMemberToOrganizationApi,
  createOrganizationApi,
  unassignMemberFromOrganizationApi,
} from "../../lib/sync/organizationApi";
import { reportNonFatal } from "../../lib/reportNonFatal";

type Props = {
  open: boolean;
  onClose: () => void;
};

type PreviewResult = {
  rows: CsvMemberRow[];
  updatedCount: number;
  createdCount: number;
  orgCount: number;
  teamCount: number;
};

type PhaseProgress = {
  phase: string;
  current: number;
  total: number;
};

export function CsvImportModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<PhaseProgress | null>(null);
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
  const showToast = useUiStore((s) => s.showToast);

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
        // 미리보기 카운트도 백엔드 dedup 규칙(trim + lowercase)에 맞춰 비교
        const norm = (s: string) => s.trim().toLowerCase();
        const existingOrgKeys = new Set(existingOrgs.map((e) => norm(e.name)));
        const existingTeamKeys = new Set(existingTeams.map((e) => norm(e.name)));
        const newOrgs = buildOrganizationsFromRows(rows).filter(
          (o) => !existingOrgKeys.has(norm(o.name)),
        );
        const newTeams = buildTeamsFromRows(rows).filter(
          (t) => !existingTeamKeys.has(norm(t.name)),
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

  const handleApply = async () => {
    if (!preview) return;
    setApplying(true);
    setProgress(null);

    let memberSuccessCount = 0;
    let memberFailCount = 0;
    let teamSuccessCount = 0;
    let orgSuccessCount = 0;

    try {
      // ── 1단계: 멤버 동기화 ──────────────────────────────────────────────
      const { updated, created } = mergeMembersFromCsv(
        useMemberStore.getState().members,
        preview.rows,
        () => "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
      );

      const memberTotal = updated.length + created.length;
      let memberCurrent = 0;

      // 신규 멤버: createMember → updateMember(신규 7개 필드)
      const finalCreated: Member[] = [];
      for (const m of created) {
        memberCurrent++;
        setProgress({ phase: "멤버 동기화 중", current: memberCurrent, total: memberTotal });
        try {
          const newMember = await createMemberApi({
            email: m.email,
            name: m.name,
            jobRole: m.jobRole || "",
            workspaceRole: "MEMBER",
          });
          const withFields = await updateMemberApi(newMember.memberId, {
            employmentStatus: m.employmentStatus ?? null,
            employeeNumber: m.employeeNumber ?? null,
            department: m.department ?? null,
            team: m.team ?? null,
            jobTitle: m.jobTitle ?? null,
            jobCategory: m.jobCategory ?? null,
            jobDetail: m.jobDetail ?? null,
            joinedAt: m.joinedAt ?? null,
          });
          upsertMember(withFields);
          finalCreated.push(withFields);
          memberSuccessCount++;
        } catch (err) {
          memberFailCount++;
          reportNonFatal(err, "csvImport.createMember");
          console.error("[CSV import] 신규 멤버 생성 실패", m.email, err);
        }
      }

      // 기존 멤버: updateMember 로 필드 갱신
      const finalUpdated: Member[] = [];
      for (const m of updated) {
        memberCurrent++;
        setProgress({ phase: "멤버 동기화 중", current: memberCurrent, total: memberTotal });
        try {
          const refreshed = await updateMemberApi(m.memberId, {
            name: m.name,
            jobRole: m.jobRole ?? null,
            jobTitle: m.jobTitle ?? null,
            employmentStatus: m.employmentStatus ?? null,
            employeeNumber: m.employeeNumber ?? null,
            department: m.department ?? null,
            team: m.team ?? null,
            jobCategory: m.jobCategory ?? null,
            jobDetail: m.jobDetail ?? null,
            joinedAt: m.joinedAt ?? null,
          });
          upsertMember(refreshed);
          finalUpdated.push(refreshed);
          memberSuccessCount++;
        } catch (err) {
          memberFailCount++;
          reportNonFatal(err, "csvImport.updateMember");
          console.error("[CSV import] 멤버 업데이트 실패", m.memberId, m.email, err);
          // 실패해도 로컬 스토어는 CSV 값으로 유지
          upsertMember(m);
          finalUpdated.push(m);
        }
      }

      const allFinalMembers = [...finalCreated, ...finalUpdated];
      const activeMembers = allFinalMembers.filter((m) => m.employmentStatus !== "퇴사");

      // ── 2단계: 팀 동기화 (AppSync createTeam + assignMemberToTeam) ──────
      const csvTeamNames = [
        ...new Set(
          preview.rows
            .filter((r) => r.employmentStatus !== "퇴사" && r.team.trim())
            .map((r) => r.team.trim()),
        ),
      ];

      // 팀명 → teamId 맵: 기존 재사용, 신규 AppSync 생성.
      // 키는 trim + lowercase 정규화 — 백엔드 createTeam 의 dedup 규칙과 동일.
      const normalize = (s: string) => s.trim().toLowerCase();
      const teamNameToId = new Map<string, string>();
      const latestTeamObjects = new Map<string, Team>();

      for (const t of useTeamStore.getState().teams) {
        teamNameToId.set(normalize(t.name), t.teamId);
        latestTeamObjects.set(t.teamId, t);
      }

      const newTeamNames = csvTeamNames.filter(
        (name) => !teamNameToId.has(normalize(name)),
      );
      for (let i = 0; i < newTeamNames.length; i++) {
        const name = newTeamNames[i];
        if (!name) continue;
        setProgress({ phase: "팀 생성 중", current: i + 1, total: newTeamNames.length });
        try {
          const created = await createTeamApi(name);
          teamNameToId.set(normalize(created.name), created.teamId);
          latestTeamObjects.set(created.teamId, created);
          upsertTeam(created);
          teamSuccessCount++;
        } catch (err) {
          reportNonFatal(err, "csvImport.createTeam");
          console.error("[CSV import] 팀 생성 실패", name, err);
        }
      }

      // 팀 배정 — CSV 를 단일 진실로 삼아 기존 배정과 diff:
      //   - 현재 배정되어 있으나 CSV 가 다른 팀(또는 없음)을 지정 → unassign
      //   - CSV 가 지정한 팀이 현재 미배정 → assign
      // memberId → 현재 서버에서 속해있는 teamId 집합
      const currentMemberTeams = new Map<string, Set<string>>();
      for (const t of useTeamStore.getState().teams) {
        for (const m of t.members) {
          const set = currentMemberTeams.get(m.memberId) ?? new Set<string>();
          set.add(t.teamId);
          currentMemberTeams.set(m.memberId, set);
        }
      }
      // memberId → CSV 가 원하는 단일 teamId (없으면 null)
      const csvDesiredTeam = new Map<string, string | null>();
      for (const m of activeMembers) {
        const tid = m.team ? teamNameToId.get(normalize(m.team)) ?? null : null;
        csvDesiredTeam.set(m.memberId, tid);
      }

      const teamOps: Array<
        { kind: "assign" | "unassign"; memberId: string; teamId: string }
      > = [];
      for (const m of activeMembers) {
        const current = currentMemberTeams.get(m.memberId) ?? new Set<string>();
        const desired = csvDesiredTeam.get(m.memberId) ?? null;
        for (const tid of current) {
          if (tid !== desired) {
            teamOps.push({ kind: "unassign", memberId: m.memberId, teamId: tid });
          }
        }
        if (desired && !current.has(desired)) {
          teamOps.push({ kind: "assign", memberId: m.memberId, teamId: desired });
        }
      }

      for (let i = 0; i < teamOps.length; i++) {
        const op = teamOps[i];
        if (!op) continue;
        setProgress({
          phase: op.kind === "assign" ? "팀 배정 중" : "팀 배정 해제 중",
          current: i + 1,
          total: teamOps.length,
        });
        try {
          if (op.kind === "assign") {
            await assignMemberToTeamApi(op.memberId, op.teamId);
          } else {
            await unassignMemberFromTeamApi(op.memberId, op.teamId);
          }
        } catch (err) {
          reportNonFatal(err, `csvImport.${op.kind}MemberTeam`);
          console.warn(`[CSV import] 팀 ${op.kind} 실패`, op, err);
        }
      }

      // 팀 로컬 스토어 멤버 목록 갱신 — CSV 가 단일 진실이므로 교체(merge 아님)
      for (const [teamId, teamObj] of latestTeamObjects) {
        const membersOfTeam = activeMembers.filter(
          (m) => m.team && teamNameToId.get(normalize(m.team)) === teamId,
        );
        upsertTeam({ ...teamObj, members: membersOfTeam });
      }

      // ── 3단계: 조직(실) 동기화 (AppSync createOrganization + assign) ───
      const csvOrgNames = [
        ...new Set(
          preview.rows
            .filter((r) => r.employmentStatus !== "퇴사" && r.department.trim())
            .map((r) => r.department.trim()),
        ),
      ];

      // 조직명 → organizationId 맵: 기존 재사용, 신규 AppSync 생성.
      // 키는 trim + lowercase 정규화 — 백엔드 createOrganization 의 dedup 규칙과 동일.
      const orgNameToId = new Map<string, string>();
      const latestOrgObjects = new Map<string, Organization>();

      for (const o of useOrganizationStore.getState().organizations) {
        orgNameToId.set(normalize(o.name), o.organizationId);
        latestOrgObjects.set(o.organizationId, o);
      }

      const newOrgNames = csvOrgNames.filter(
        (name) => !orgNameToId.has(normalize(name)),
      );
      for (let i = 0; i < newOrgNames.length; i++) {
        const name = newOrgNames[i];
        if (!name) continue;
        setProgress({ phase: "조직 생성 중", current: i + 1, total: newOrgNames.length });
        try {
          const created = await createOrganizationApi(name);
          orgNameToId.set(normalize(created.name), created.organizationId);
          latestOrgObjects.set(created.organizationId, created);
          upsertOrganization(created);
          orgSuccessCount++;
        } catch (err) {
          reportNonFatal(err, "csvImport.createOrganization");
          console.error("[CSV import] 조직 생성 실패", name, err);
        }
      }

      // 조직 배정 — 팀과 동일하게 CSV 단일 진실 diff 방식
      const currentMemberOrgs = new Map<string, Set<string>>();
      for (const o of useOrganizationStore.getState().organizations) {
        for (const m of o.members) {
          const set = currentMemberOrgs.get(m.memberId) ?? new Set<string>();
          set.add(o.organizationId);
          currentMemberOrgs.set(m.memberId, set);
        }
      }
      const csvDesiredOrg = new Map<string, string | null>();
      for (const m of activeMembers) {
        const oid = m.department
          ? orgNameToId.get(normalize(m.department)) ?? null
          : null;
        csvDesiredOrg.set(m.memberId, oid);
      }

      const orgOps: Array<
        { kind: "assign" | "unassign"; memberId: string; organizationId: string }
      > = [];
      for (const m of activeMembers) {
        const current = currentMemberOrgs.get(m.memberId) ?? new Set<string>();
        const desired = csvDesiredOrg.get(m.memberId) ?? null;
        for (const oid of current) {
          if (oid !== desired) {
            orgOps.push({
              kind: "unassign",
              memberId: m.memberId,
              organizationId: oid,
            });
          }
        }
        if (desired && !current.has(desired)) {
          orgOps.push({
            kind: "assign",
            memberId: m.memberId,
            organizationId: desired,
          });
        }
      }

      for (let i = 0; i < orgOps.length; i++) {
        const op = orgOps[i];
        if (!op) continue;
        setProgress({
          phase: op.kind === "assign" ? "조직 배정 중" : "조직 배정 해제 중",
          current: i + 1,
          total: orgOps.length,
        });
        try {
          if (op.kind === "assign") {
            await assignMemberToOrganizationApi(op.memberId, op.organizationId);
          } else {
            await unassignMemberFromOrganizationApi(op.memberId, op.organizationId);
          }
        } catch (err) {
          reportNonFatal(err, `csvImport.${op.kind}MemberOrganization`);
          console.warn(`[CSV import] 조직 ${op.kind} 실패`, op, err);
        }
      }

      // 조직 로컬 스토어 멤버 목록 갱신 — CSV 가 단일 진실
      for (const [organizationId, orgObj] of latestOrgObjects) {
        const membersOfOrg = activeMembers.filter(
          (m) =>
            m.department &&
            orgNameToId.get(normalize(m.department)) === organizationId,
        );
        upsertOrganization({ ...orgObj, members: membersOfOrg });
      }

      // ── 4단계: 직무 목록 병합 ───────────────────────────────────────────
      const mergedTitles = [
        ...new Set([...currentJobTitles, ...extractJobTitles(preview.rows)]),
      ].sort((a, b) => a.localeCompare(b, "ko"));
      const mergedCats = [
        ...new Set([...currentJobCategories, ...extractJobCategories(preview.rows)]),
      ].sort((a, b) => a.localeCompare(b, "ko"));
      const mergedDetails = [
        ...new Set([...currentJobDetails, ...extractJobDetails(preview.rows)]),
      ].sort((a, b) => a.localeCompare(b, "ko"));
      setOptions({ jobTitles: mergedTitles, jobCategories: mergedCats, jobDetails: mergedDetails });

      // 완료 토스트
      if (memberFailCount > 0) {
        showToast(
          `구성원 ${memberSuccessCount}명 / 팀 ${teamSuccessCount}개 / 조직 ${orgSuccessCount}개 동기화 완료, ${memberFailCount}명 저장 실패. 콘솔을 확인해주세요.`,
          { kind: "error" },
        );
      } else {
        showToast(
          `구성원 ${memberSuccessCount}명 / 팀 ${teamSuccessCount}개 / 조직 ${orgSuccessCount}개 동기화 완료`,
          { kind: "success" },
        );
      }

      setDone(true);
    } finally {
      setApplying(false);
      setProgress(null);
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
              <div className="text-zinc-600 dark:text-zinc-300">· 전체 파싱: <strong>{preview.rows.length}</strong>명</div>
              <div className="text-zinc-600 dark:text-zinc-300">· 기존 멤버 업데이트: <strong>{preview.updatedCount}</strong>명</div>
              <div className="text-zinc-600 dark:text-zinc-300">· 신규 멤버 추가: <strong>{preview.createdCount}</strong>명</div>
              <div className="text-zinc-600 dark:text-zinc-300">· 신규 조직(실) 생성: <strong>{preview.orgCount}</strong>개</div>
              <div className="text-zinc-600 dark:text-zinc-300">· 신규 팀 생성: <strong>{preview.teamCount}</strong>개</div>
            </div>
          )}

          {/* 진행 상태 바 */}
          {applying && progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{progress.phase}...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-zinc-800 transition-all dark:bg-zinc-200"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* 완료 메시지 */}
          {done && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              가져오기 완료. 구성원·조직·팀·직무 목록이 동기화되었습니다.
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {preview && !done ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={applying}
              className="rounded border px-3 py-1 text-xs disabled:opacity-50"
            >
              다시 선택
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="rounded border px-3 py-1 text-xs disabled:opacity-50"
            >
              {done ? "닫기" : "취소"}
            </button>
            {preview && !done && (
              <button
                type="button"
                onClick={() => { void handleApply(); }}
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
