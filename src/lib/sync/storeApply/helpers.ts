// storeApply 의 순수 헬퍼 함수 모음.
// 외부 store / side-effect 없음. 입력으로만 결과 산출.
import { z } from "zod";
import type { GqlPage } from "../graphql/operations";
import type { Page } from "../../../types/page";
import type { JSONContent } from "@tiptap/react";
import {
  isLCSchedulerDatabaseId,
} from "../../scheduler/database";
import { stringifyAwsJson } from "../../util/awsJson";
import { DocEnvelopeSchema, DbCellsSchema } from "../schemas";

/** 원격 ISO 문자열 → epoch ms. 실패 시 0. */
export function isoToMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * AppSync AWSJSON 응답은 보통 JSON 문자열로 도착한다. Amplify 가 객체로 풀어주는 경우도 있어 양쪽 대응.
 * schema 를 주면 파싱 결과의 shape 를 검증하고, 깨진 모양이면 fallback 으로 떨군다(silent corruption 방지).
 * 검증 실패는 기존 JSON.parse 실패와 동일하게 조용히 fallback — 이 헬퍼는 side-effect 없는 순수 함수다.
 */
export function parseAwsJson<T>(v: unknown, fallback: T, schema?: z.ZodTypeAny): T {
  if (v == null) return fallback;
  let parsed: unknown;
  if (typeof v === "string") {
    try {
      parsed = JSON.parse(v);
    } catch {
      return fallback;
    }
  } else {
    parsed = v;
  }
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) return fallback;
    return result.data as T;
  }
  return parsed as T;
}

export function isRemoteNewer(localUpdatedMs: number, remoteIso: string): boolean {
  return isoToMs(remoteIso) > localUpdatedMs;
}

/** GraphQL Page 의 order 를 스토어 number 와 동일 규칙으로 정규화 */
export function gqlOrderNumber(p: { order?: string | null; updatedAt: string }): number {
  const n = p.order == null || p.order === "" ? NaN : Number(p.order);
  if (!Number.isNaN(n)) return n;
  return isoToMs(p.updatedAt);
}

export function gqlDatabaseId(p: GqlPage): string | null {
  return p.databaseId ?? null;
}

export function isLCSchedulerPage(p: GqlPage): boolean {
  return Boolean(p.databaseId && isLCSchedulerDatabaseId(p.databaseId));
}

export function stringArrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** AppSync upsertPage 뮤테이션용 페이로드. AWSJSON 필드는 항상 string. */
export function toPageInputPayload(
  p: GqlPage,
): Record<string, unknown> & { id: string; updatedAt?: string } {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    createdByMemberId: p.createdByMemberId,
    title: p.title,
    titleColor: typeof p.titleColor === "string" ? p.titleColor : null,
    icon: p.icon ?? null,
    coverImage: p.coverImage ?? null,
    parentId: p.parentId ?? null,
    // order 는 byDatabaseAndOrder GSI sort key — null/빈 값이면 GSI 에서 누락되어
    // listDatabaseRows 에 안 잡힌다. 항상 유효한 문자열로 보정한다(updatedAt 폴백).
    order: String(gqlOrderNumber(p)),
    databaseId: p.databaseId ?? null,
    doc:
      stringifyAwsJson(p.doc) ??
      "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
    dbCells: stringifyAwsJson(p.dbCells),
    blockComments: stringifyAwsJson(p.blockComments),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // 값이 있을 때만 싣는다 — 키 부재 시 서버가 기존 태그를 보존한다(유령 페이지 방지).
    ...(p.fullPageDatabaseId != null
      ? { fullPageDatabaseId: p.fullPageDatabaseId }
      : {}),
  };
}

/** 동일 updatedAt(LWW 동률)일 때 사이드바 트리가 어긋나 있으면 원격 메타를 받아들인다 */
export function isPageStructuralDrift(local: Page, p: GqlPage): boolean {
  const remoteParent = p.parentId ?? null;
  const remoteOrder = gqlOrderNumber(p);
  const remoteDb = gqlDatabaseId(p);
  const localDb = local.databaseId ?? null;
  return (
    local.parentId !== remoteParent ||
    local.order !== remoteOrder ||
    localDb !== remoteDb
  );
}

/** 페이지 원격 덮어쓰기 여부 — 순수 초과 외에 LWW 동률+구조 불일치도 허용 */
export function shouldApplyRemotePageOverwrite(
  local: Page | undefined,
  p: GqlPage,
): boolean {
  if (!local) return true;
  const remoteMs = isoToMs(p.updatedAt);
  const localMs = local.updatedAt;
  if (remoteMs > localMs) return true;
  if (remoteMs === localMs && localMs > 0 && isPageStructuralDrift(local, p)) {
    return true;
  }
  return false;
}

export function gqlPageToLocalPage(p: GqlPage): Page {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    title: p.title,
    titleColor: typeof p.titleColor === "string" ? p.titleColor : null,
    icon: p.icon ?? null,
    coverImage: typeof p.coverImage === "string" ? p.coverImage : null,
    doc: (() => {
      const parsed = parseAwsJson<JSONContent>(p.doc, {
        type: "doc",
        content: [{ type: "paragraph" }],
      }, DocEnvelopeSchema);
      if (parsed.content) {
        parsed.content = parsed.content.filter(Boolean);
      }
      return parsed;
    })(),
    parentId: p.parentId ?? null,
    order: gqlOrderNumber(p),
    databaseId: p.databaseId ?? undefined,
    fullPageDatabaseId: p.fullPageDatabaseId ?? undefined,
    dbCells: parseAwsJson<Page["dbCells"]>(p.dbCells, undefined, DbCellsSchema),
    createdByMemberId: p.createdByMemberId ?? undefined,
    lastEditedByMemberId: p.lastEditedByMemberId ?? undefined,
    lastEditedByName: p.lastEditedByName ?? undefined,
    createdAt: isoToMs(p.createdAt) || Date.now(),
    updatedAt: isoToMs(p.updatedAt) || Date.now(),
    contentLoaded: true,
  };
}

/** 로컬 순서를 우선하되, 원격에서 새로 내려온 행 페이지는 끝에 붙인다. */
export function mergeRowPageOrderWithDerived(
  localOrder: string[] | undefined,
  derived: string[],
): string[] {
  if (!derived.length) return localOrder?.length ? [...localOrder] : [];
  if (!localOrder?.length) return derived;
  const derivedSet = new Set(derived);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of localOrder) {
    if (!derivedSet.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  for (const id of derived) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}
