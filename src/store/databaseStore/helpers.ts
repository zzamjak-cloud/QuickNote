// databaseStore 내부 헬퍼 — 순수 유틸 + sync enqueue 래퍼.
// databaseStore.ts 에서 분리 — 동작 변경 없음.

import type {
  CellValue,
  ColumnDef,
  DatabaseBundle,
  DatabaseMeta,
  DatabaseRowPreset,
} from "../../types/database";
import type { DatabaseSnapshot, PageSnapshot } from "../../types/history";
import type { Page } from "../../types/page";
import { newId } from "../../lib/id";
import { createRowPageLinkedToDatabase } from "../../lib/services/databaseRowPages";
import { enqueueAsync } from "../../lib/sync/runtime";
import { useAuthStore } from "../authStore";
import { useWorkspaceStore } from "../workspaceStore";
import { usePageStore } from "../pageStore";
import type { DbMap } from "./migrations";

// v5 fallback: 아직 memberStore(me.memberId)와 완전 연동 전이라 auth sub 를 사용.
export function getCreatedByMemberId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

export function getCurrentWorkspaceId(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "";
}

// 클라이언트 number(epoch ms) → GraphQL 경계 ISO 문자열 변환.
// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다.
export function toGqlDatabase(
  meta: DatabaseMeta,
  columns: ColumnDef[],
  createdByMemberId: string,
  presets?: DatabaseRowPreset[],
): Record<string, unknown> {
  return {
    id: meta.id,
    workspaceId: getCurrentWorkspaceId(),
    createdByMemberId,
    title: meta.title,
    columns: JSON.stringify(columns),
    presets: JSON.stringify(presets ?? []),
    createdAt: new Date(meta.createdAt).toISOString(),
    updatedAt: new Date(meta.updatedAt).toISOString(),
  };
}

export function enqueueUpsertDatabase(bundle: DatabaseBundle): void {
  if (!getCurrentWorkspaceId()) {
    console.warn("[sync] upsertDatabase skipped: workspaceId 미설정", { dbId: bundle.meta.id });
    return;
  }
  const payload = toGqlDatabase(
    bundle.meta,
    bundle.columns,
    getCreatedByMemberId(),
    bundle.presets,
  );
  enqueueAsync(
    "upsertDatabase",
    payload as Record<string, unknown> & { id: string; updatedAt?: string },
  );
}

// 행 페이지를 직접 mutate 한 경우 페이지 enqueue 를 보조해주는 헬퍼.
// doc/dbCells 는 AppSync AWSJSON 요구사항에 맞춰 JSON.stringify 로 직렬화.
export function enqueueUpsertPageRaw(p: Page): void {
  const createdByMemberId = getCreatedByMemberId();
  enqueueAsync(
    "upsertPage",
    {
      id: p.id,
      workspaceId: getCurrentWorkspaceId(),
      createdByMemberId,
      title: p.title,
      icon: p.icon ?? null,
      parentId: p.parentId ?? null,
      order: String(p.order),
      databaseId: p.databaseId ?? null,
      doc: JSON.stringify(p.doc),
      dbCells: p.dbCells ? JSON.stringify(p.dbCells) : null,
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

/** 컬럼별 기본 셀 값 — 현재는 status만 첫 옵션을 채움, 나머지는 null. */
export function defaultCellValueForColumn(col: ColumnDef): CellValue {
  if (col.type === "status") {
    return col.config?.options?.[0]?.id ?? null;
  }
  return null;
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
