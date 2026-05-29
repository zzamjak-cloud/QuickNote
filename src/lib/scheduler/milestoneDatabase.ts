// LC 워크스페이스 전용 "마일스톤" 보호 DB — 작업·피처 DB와 연동되는 고정 DB.
// 작업/피처와 분리된 prefix(`lc-milestone-db:`) 를 사용해 식별한다.

import type { ColumnDef, DatabaseBundle } from "../../types/database";
import { resolveLCSchedulerWorkspaceId } from "./scope";
import {
  LC_MILESTONE_DATABASE_ID_PREFIX,
  LC_MILESTONE_DATABASE_TITLE,
  LC_MILESTONE_DATABASE_ID,
} from "./database";

/** 마일스톤 DB 컬럼 ID 상수 — 외부에서 컬럼을 안전하게 참조하기 위한 키. */
export const LC_MILESTONE_COLUMN_IDS = {
  title: "lc-milestone:title",
  status: "lc-milestone:status",
  goal: "lc-milestone:goal",
  detail: "lc-milestone:detail",
  qaStart: "lc-milestone:qaStart",
  submit: "lc-milestone:submit",
  release: "lc-milestone:release",
  devPeriod: "lc-milestone:devPeriod",
  organization: "lc-milestone:organization",
  team: "lc-milestone:team",
  project: "lc-milestone:project",
  regular: "lc-milestone:regular",
  projectProgress: "lc-milestone:projectProgress",
  os: "lc-milestone:os",
  participants: "lc-milestone:participants",
  linkedProject: "lc-milestone:linkedProject",
} as const;

export function makeLCMilestoneDatabaseId(workspaceId: string): string {
  return `${LC_MILESTONE_DATABASE_ID_PREFIX}${workspaceId}`;
}


/** 마일스톤 DB의 기본 컬럼 정의 */
function lcMilestoneColumns(): ColumnDef[] {
  return [
    { id: LC_MILESTONE_COLUMN_IDS.title, name: "마일스톤", type: "title", width: 200 },
    {
      id: LC_MILESTONE_COLUMN_IDS.status,
      name: "상태",
      type: "status",
      width: 130,
      config: {
        options: [
          { id: "archive", label: "아카이브", color: "#94a3b8" },
          { id: "planned", label: "예정", color: "#a78bfa" },
          { id: "current", label: "현재", color: "#3b82f6" },
          { id: "next", label: "다음", color: "#f59e0b" },
          { id: "done", label: "완료", color: "#10b981" },
        ],
      },
    },
    { id: LC_MILESTONE_COLUMN_IDS.goal, name: "목표", type: "text", width: 200 },
    { id: LC_MILESTONE_COLUMN_IDS.detail, name: "상세", type: "text", width: 240 },
    { id: LC_MILESTONE_COLUMN_IDS.qaStart, name: "QA시작", type: "date", width: 130 },
    { id: LC_MILESTONE_COLUMN_IDS.submit, name: "서밋", type: "date", width: 130 },
    { id: LC_MILESTONE_COLUMN_IDS.release, name: "출시", type: "date", width: 130 },
    {
      id: LC_MILESTONE_COLUMN_IDS.devPeriod,
      name: "개발기간",
      type: "date",
      width: 160,
      config: { dateShowEnd: true },
    },
    {
      id: LC_MILESTONE_COLUMN_IDS.organization,
      name: "조직",
      type: "select",
      width: 140,
      // 퀵노트 organizationStore와 옵션 자동 미러링
      config: { linkedScope: "organization" },
    },
    {
      id: LC_MILESTONE_COLUMN_IDS.team,
      name: "팀",
      type: "select",
      width: 140,
      // 퀵노트 teamStore와 옵션 자동 미러링
      config: { linkedScope: "team" },
    },
    {
      id: LC_MILESTONE_COLUMN_IDS.project,
      name: "프로젝트",
      type: "select",
      width: 140,
      // schedulerProjectsStore와 옵션 자동 미러링
      config: { linkedScope: "project" },
    },
    { id: LC_MILESTONE_COLUMN_IDS.regular, name: "정기콘텐츠", type: "text", width: 200 },
    {
      id: LC_MILESTONE_COLUMN_IDS.projectProgress,
      name: "프로젝트진행률",
      type: "progress",
      width: 160,
      // progressSource는 사용자가 컬럼 편집에서 직접 지정 (대상 DB·컬럼·완료값).
    },
    {
      id: LC_MILESTONE_COLUMN_IDS.os,
      name: "OS",
      type: "multiSelect",
      width: 160,
      config: {
        options: [
          { id: "AOS", label: "AOS", color: "#10b981" },
          { id: "iOS", label: "iOS", color: "#3b82f6" },
          { id: "Web", label: "Web", color: "#a855f7" },
        ],
      },
    },
    { id: LC_MILESTONE_COLUMN_IDS.participants, name: "참여자", type: "person", width: 180 },
    {
      id: LC_MILESTONE_COLUMN_IDS.linkedProject,
      name: "연결 페이지",
      type: "pageLink",
      width: 200,
      // pageLinkScopeDatabaseId / searchFilters는 사용자가 컬럼 편집에서 지정.
    },
  ];
}


/** 마일스톤 DB 시드/스키마 갱신 — 누락 컬럼 자동 추가, 사용자 데이터는 보존. */
export async function ensureLCMilestoneDatabase(workspaceId: string): Promise<void> {
  const [{ useDatabaseStore }, { enqueueUpsertDatabase }] = await Promise.all([
    import("../../store/databaseStore"),
    import("../../store/databaseStore/helpers"),
  ]);
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCMilestoneDatabaseId(schedulerWorkspaceId);
  const existing = useDatabaseStore.getState().databases[databaseId];
  if (existing) return;

  const t = Date.now();
  const next: DatabaseBundle = {
    meta: {
      id: databaseId,
      workspaceId: schedulerWorkspaceId,
      title: LC_MILESTONE_DATABASE_TITLE,
      createdAt: t,
      updatedAt: t,
    },
    columns: lcMilestoneColumns(),
    presets: [],
    rowPageOrder: [],
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [databaseId]: next },
  }));
  enqueueUpsertDatabase(next);
}

export { LC_MILESTONE_DATABASE_ID, LC_MILESTONE_DATABASE_TITLE };
