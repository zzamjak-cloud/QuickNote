// databaseStore 내부 헬퍼 — 순수 유틸 + sync enqueue 래퍼.
// databaseStore.ts 에서 분리 — 동작 변경 없음.

import type {
  CellValue,
  ColumnDef,
  DatabaseBundle,
  DatabaseMeta,
  DatabaseRowPreset,
  DatabaseTemplate,
  FilterRule,
} from "../../types/database";
import type { DatabaseSnapshot, PageSnapshot } from "../../types/history";
import type { Page } from "../../types/page";
import { newId } from "../../lib/id";
import { isCellValueDerived } from "../../lib/database/columnSource";
import { createRowPageLinkedToDatabase } from "../../lib/services/databaseRowPages";
import { enqueueAsync } from "../../lib/sync/runtime";
import {
  serializeColumns,
  serializePanelState,
  serializePresets,
} from "../../lib/database/schema/normalizeDatabase";
import { useAuthStore } from "../authStore";
import { useWorkspaceStore } from "../workspaceStore";
import { usePageStore } from "../pageStore";
import { isLCSchedulerDatabaseId, isLCMilestoneDatabaseId, isLCFeatureDatabaseId } from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { getDbCollab, isDbCollabActive } from "../../lib/collab/dbCollabRegistry";
import { reconcileStructureIntoYDoc } from "../../lib/collab/dbStructureReconcile";
import type { DbMap } from "./migrations";

// v5 fallback: 아직 memberStore(me.memberId)와 완전 연동 전이라 auth sub 를 사용.
export function getCreatedByMemberId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

export function getCurrentWorkspaceId(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "";
}

function resolveWorkspaceIdByDatabaseId(databaseId: string | null | undefined): string {
  if (isLCSchedulerDatabaseId(databaseId) || isLCMilestoneDatabaseId(databaseId) || isLCFeatureDatabaseId(databaseId)) {
    return LC_SCHEDULER_WORKSPACE_ID;
  }
  return getCurrentWorkspaceId();
}

// 클라이언트 number(epoch ms) → GraphQL 경계 ISO 문자열 변환.
// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다.
export function toGqlDatabase(
  meta: DatabaseMeta,
  columns: ColumnDef[],
  createdByMemberId: string,
  presets?: DatabaseRowPreset[],
  panelState?: DatabaseBundle["panelState"],
  templates?: DatabaseTemplate[],
): Record<string, unknown> {
  const workspaceId = meta.workspaceId ?? resolveWorkspaceIdByDatabaseId(meta.id);
  const payload: Record<string, unknown> = {
    id: meta.id,
    workspaceId,
    createdByMemberId,
    title: meta.title,
    columns: serializeColumns(columns),
    presets: serializePresets(presets),
    createdAt: new Date(meta.createdAt).toISOString(),
    updatedAt: new Date(meta.updatedAt).toISOString(),
  };
  // 서버 upsert 는 전체 항목 교체(PutItem)다. panelState 가 없을 때 빈 객체를 실으면
  // 서버의 기존 필터 프리셋 탭이 통째로 사라진다. 값이 있을 때만 전송한다.
  // (panelState 미지정 → 키 생략 → 수신 측은 local panelState 로 폴백)
  if (panelState !== undefined) {
    payload.panelState = serializePanelState(panelState);
  }
  if (templates !== undefined) {
    payload.templates = JSON.stringify(templates);
  }
  return payload;
}

export function enqueueUpsertDatabase(
  bundle: DatabaseBundle,
  templates?: DatabaseTemplate[],
  opts?: { skipCollab?: boolean },
): void {
  // 협업 ON DB: LWW 대신 Y.Doc 에 구조 reconcile. 서버 영속은 materialize→applyCollabDbStructure(skipCollab) 가 담당.
  if (!opts?.skipCollab) {
    const collab = getDbCollab(bundle.meta.id);
    if (collab) {
      reconcileStructureIntoYDoc(collab.doc, {
        columns: bundle.columns,
        presets: bundle.presets ?? [],
        panelState: bundle.panelState ?? {},
        rowPageOrder: bundle.rowPageOrder,
        rows: {},
        rowMembers: bundle.rowPageOrder,
      }, collab.baseline);
      return;
    }
  }
  const workspaceId = bundle.meta.workspaceId ?? resolveWorkspaceIdByDatabaseId(bundle.meta.id);
  if (!workspaceId) {
    console.warn("[sync] upsertDatabase skipped: workspaceId 미설정", { dbId: bundle.meta.id });
    return;
  }
  const payload = toGqlDatabase(
    bundle.meta,
    bundle.columns,
    getCreatedByMemberId(),
    bundle.presets,
    bundle.panelState,
    templates,
  );
  enqueueAsync(
    "upsertDatabase",
    payload as Record<string, unknown> & { id: string; updatedAt?: string },
  );
}

// 행 페이지를 직접 mutate 한 경우 페이지 enqueue 를 보조해주는 헬퍼.
// doc/dbCells 는 AppSync AWSJSON 요구사항에 맞춰 JSON.stringify 로 직렬화.
// 협업 ON DB 행 페이지는 셀 권위가 Y.Doc 이므로, materialize(includeCells)가 아닌
// 비셀 변경발 upsert 는 dbCells 를 제외해 다른 클라 셀의 LWW 스톰프를 막는다.
export function enqueueUpsertPageRaw(p: Page, opts?: { includeCells?: boolean }): void {
  const createdByMemberId = getCreatedByMemberId();
  const workspaceId = p.workspaceId ?? resolveWorkspaceIdByDatabaseId(p.databaseId ?? null);
  const collabActive = p.databaseId ? isDbCollabActive(p.databaseId) : false;
  const dbCells =
    collabActive && !opts?.includeCells ? null : p.dbCells ? JSON.stringify(p.dbCells) : null;
  enqueueAsync(
    "upsertPage",
    {
      id: p.id,
      workspaceId,
      createdByMemberId,
      title: p.title,
      icon: p.icon ?? null,
      parentId: p.parentId ?? null,
      order: String(p.order),
      databaseId: p.databaseId ?? null,
      doc: JSON.stringify(p.doc),
      dbCells,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
    } as Record<string, unknown> & { id: string; updatedAt?: string },
  );
}

export function seedColumns(): ColumnDef[] {
  return [
    { id: newId(), name: "이름", type: "title" },
    { id: newId(), name: "텍스트", type: "text" },
  ];
}

/** 컬럼별 기본 셀 값 — status는 첫 옵션, pageLink는 빈 배열, 나머지는 null. */
export function defaultCellValueForColumn(col: ColumnDef): CellValue {
  if (col.type === "status") {
    return col.config?.options?.[0]?.id ?? null;
  }
  if (col.type === "pageLink") {
    return [];
  }
  return null;
}

// 배열(다중 값)로 저장되는 컬럼 타입 — 시드 값도 배열로 감싸야 필터를 통과한다.
const ARRAY_VALUED_COLUMN_TYPES = new Set<ColumnDef["type"]>([
  "pageLink",
  "multiSelect",
  "person",
  "itemFetch",
]);

/**
 * 활성 필터 규칙을 만족시키는 새 행의 셀 시드 값을 계산한다.
 * 필터가 걸린 상태에서 행을 추가해도 결과 목록에서 곧바로 보이도록,
 * 해당 필터를 통과하는 값을 컬럼에 주입한다.
 * 주입할 값이 없거나 기본(null/빈) 값이 이미 조건을 충족하면 undefined 반환.
 */
export function seedValueForFilterRule(
  col: ColumnDef,
  rule: FilterRule,
): CellValue | undefined {
  const value = rule.value ?? "";
  switch (rule.operator) {
    case "equals":
    case "contains": {
      if (value === "") return undefined;
      if (col.type === "number") {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      // pageLink/multiSelect/person 등은 id 배열로 저장된다.
      if (ARRAY_VALUED_COLUMN_TYPES.has(col.type)) return [value];
      // text/title/select/status(옵션 id)/그 외는 필터 값 그대로.
      return value;
    }
    case "isNotEmpty": {
      // 비어있지 않기만 하면 되는 케이스 — 안전하게 채울 수 있는 타입만 처리.
      if (col.type === "status" || col.type === "select") {
        return col.config?.options?.[0]?.id ?? undefined;
      }
      if (col.type === "number") return 0;
      return undefined;
    }
    case "gt":
    case "lt": {
      if (col.type !== "number") return undefined;
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return rule.operator === "gt" ? n + 1 : n - 1;
    }
    // isEmpty, notEquals → 기본(null/빈) 값이 이미 조건을 충족하므로 주입 불필요.
    default:
      return undefined;
  }
}

/**
 * 활성 필터 규칙들을 만족시키는 새 행의 셀 시드 묶음을 계산한다.
 * 일반 컬럼은 seedValueForFilterRule 로 직접 주입한다.
 * 단, 자동화(파생) 컬럼(sourceFromDb.automation/viaPageLinkColumnId)은 raw 셀 시드가
 * 필터에서 무시되므로(필터는 파생값을 본다), 소스 DB를 가리키는 pageLink 컬럼을
 * 필터값과 일치하는 소스 행으로 연결해 파생값이 필터를 통과하도록 한다.
 * 예) 피처의 "프로젝트"가 연결된 마일스톤에서 파생될 때 → 그 프로젝트의 마일스톤을 링크.
 */
export function seedDefaultsForFilters(
  bundle: DatabaseBundle,
  seedFilters: FilterRule[],
  databases: Record<string, DatabaseBundle>,
  pages: Record<string, Page>,
): Record<string, CellValue> {
  const defaults: Record<string, CellValue> = {};
  for (const rule of seedFilters) {
    const col = bundle.columns.find((c) => c.id === rule.columnId);
    if (!col) continue;
    const src = col.config?.sourceFromDb;
    if (isCellValueDerived(col) && src?.databaseId && src.columnId && rule.value) {
      const sourceDb = databases[src.databaseId];
      if (!sourceDb) continue;
      const targetValue = rule.value;
      // 소스 DB(예: 마일스톤)에서 파생 기준 컬럼 값이 필터값과 일치하는 첫 행을 찾는다.
      const matchSourcePageId = sourceDb.rowPageOrder.find((pid) => {
        const v = pages[pid]?.dbCells?.[src.columnId];
        return Array.isArray(v) ? (v as unknown[]).includes(targetValue) : v === targetValue;
      });
      if (!matchSourcePageId) continue;
      // 소스 행을 가리킬 pageLink 컬럼 (viaPageLinkColumnId 우선 → scope 일치 → 첫 pageLink).
      const linkCol =
        bundle.columns.find((c) => c.type === "pageLink" && c.id === src.viaPageLinkColumnId) ??
        bundle.columns.find(
          (c) => c.type === "pageLink" && c.config?.pageLinkScopeDatabaseId === src.databaseId,
        ) ??
        bundle.columns.find((c) => c.type === "pageLink");
      if (linkCol) defaults[linkCol.id] = [matchSourcePageId];
      continue;
    }
    const seeded = seedValueForFilterRule(col, rule);
    if (seeded !== undefined) defaults[col.id] = seeded;
  }
  return defaults;
}

/** 표시용 제목 정규화 — 비교·중복 검사에 공통 사용 */
export function normalizeDbTitle(title: string): string {
  return title.trim() || "제목 없음";
}

export function isDatabaseTitleTaken(
  databases: DbMap,
  title: string,
  exceptId: string,
): boolean {
  const n = normalizeDbTitle(title);
  for (const [id, b] of Object.entries(databases)) {
    if (id === exceptId) continue;
    if (normalizeDbTitle(b.meta.title) === n) return true;
  }
  return false;
}

/** 신규 DB용 — 기존과 겹치지 않는 제목 */
export function allocateUniqueDatabaseTitle(
  databases: DbMap,
  preferred: string,
): string {
  let base = normalizeDbTitle(preferred);
  if (base === "제목 없음") base = "새 데이터베이스";
  let candidate = base;
  let n = 2;
  while (isDatabaseTitleTaken(databases, candidate, "")) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  return candidate;
}

/** 행 페이지를 직접 생성하고 id를 반환 — `databaseRowPages`에서 pageStore 와 연결. */
export function createRowPage(databaseId: string, title: string): string {
  return createRowPageLinkedToDatabase(databaseId, title);
}

export function toDatabaseSnapshot(bundle: DatabaseBundle): DatabaseSnapshot {
  return structuredClone(bundle);
}

export function toPageSnapshot(
  page: ReturnType<typeof usePageStore.getState>["pages"][string],
): PageSnapshot {
  return {
    id: page.id,
    title: page.title,
    titleColor: page.titleColor ?? null,
    icon: page.icon,
    doc: structuredClone(page.doc),
    parentId: page.parentId,
    order: page.order,
    databaseId: page.databaseId,
    dbCells: page.dbCells ? structuredClone(page.dbCells) : undefined,
  };
}

export function extractFullPageDatabaseId(
  page: ReturnType<typeof usePageStore.getState>["pages"][string],
): string | null {
  const first = page.doc?.content?.[0] as
    | { type?: string; attrs?: Record<string, unknown> }
    | undefined;
  if (!first || first.type !== "databaseBlock") return null;
  const attrs = first.attrs ?? {};
  if (attrs.layout !== "fullPage") return null;
  return typeof attrs.databaseId === "string" ? attrs.databaseId : null;
}

export function makeReferenceCellValue(
  cols: ColumnDef[],
  sourceDbId: string,
  sourceTitle: string,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  const refValue = `quicknote://database/${sourceDbId}`;
  const urlCol = cols.find((c) => c.type === "url");
  const textCol = cols.find((c) => c.type === "text");
  const fallbackCol = cols.find((c) => c.type !== "title");
  const target = urlCol ?? textCol ?? fallbackCol;
  if (!target) return out;
  out[target.id] =
    target.type === "url" ? refValue : `DB 참조: ${sourceTitle} (${sourceDbId})`;
  return out;
}

export function isValidDatabaseSnapshot(
  snapshot: DatabaseSnapshot | null,
): snapshot is DatabaseSnapshot {
  if (!snapshot) return false;
  if (!Array.isArray(snapshot.columns)) return false;
  if (!Array.isArray(snapshot.rowPageOrder)) return false;
  if (!snapshot.meta || typeof snapshot.meta.id !== "string") return false;
  return true;
}
