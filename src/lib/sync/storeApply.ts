// 원격(GraphQL) 변경을 로컬 zustand 스토어에 LWW 로 적용한다.
// - GraphQL 쪽은 ISO 문자열, 로컬 스토어는 epoch ms(number) — 경계에서 변환.
// - tombstone(deletedAt != null) 이면 로컬에서 제거.
// - 로컬이 더 신선하면 무시(LWW).

import type {
  GqlPage,
  GqlDatabase,
} from "./graphql/operations";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import type { Page } from "../../types/page";
import type {
  ColumnDef,
  DatabaseBundle,
} from "../../types/database";
import type { JSONContent } from "@tiptap/react";

// 원격 ISO 문자열 → epoch ms (실패 시 0).
function isoToMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

// AppSync AWSJSON 응답은 보통 JSON 문자열로 도착한다(Amplify 가 자동 parse 해주는 경우도 있어 객체일 수 있음).
// 둘 다 안전하게 처리한다.
function parseAwsJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function isRemoteNewer(localUpdatedMs: number, remoteIso: string): boolean {
  return isoToMs(remoteIso) > localUpdatedMs;
}

export function applyRemotePageToStore(p: GqlPage | null | undefined): void {
  if (!p) return;
  usePageStore.setState((s) => {
    const local = s.pages[p.id];
    // tombstone — 로컬에서 제거.
    if (p.deletedAt) {
      if (!local) return s;
      const rest = { ...s.pages };
      delete rest[p.id];
      let nextActive = s.activePageId;
      if (s.activePageId === p.id) nextActive = null;
      return { ...s, pages: rest, activePageId: nextActive };
    }
    // 로컬이 더 신선하면 무시.
    if (local && !isRemoteNewer(local.updatedAt, p.updatedAt)) return s;

    const orderNum = (() => {
      const n = Number(p.order);
      if (!Number.isNaN(n)) return n;
      return isoToMs(p.updatedAt);
    })();

    const merged: Page = {
      id: p.id,
      title: p.title,
      icon: p.icon ?? null,
      doc: parseAwsJson<JSONContent>(p.doc, {
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      parentId: p.parentId ?? null,
      order: orderNum,
      databaseId: p.databaseId ?? undefined,
      dbCells: parseAwsJson<Page["dbCells"]>(p.dbCells, undefined),
      createdAt: isoToMs(p.createdAt) || Date.now(),
      updatedAt: isoToMs(p.updatedAt) || Date.now(),
    };
    return { ...s, pages: { ...s.pages, [p.id]: merged } };
  });
}

export function applyRemoteDatabaseToStore(
  d: GqlDatabase | null | undefined,
): void {
  if (!d) return;
  useDatabaseStore.setState((s) => {
    const local = s.databases[d.id];
    if (d.deletedAt) {
      if (!local) return s;
      const rest = { ...s.databases };
      delete rest[d.id];
      return { ...s, databases: rest };
    }
    if (local && !isRemoteNewer(local.meta.updatedAt, d.updatedAt)) return s;

    const columns = parseAwsJson<ColumnDef[]>(d.columns, []);
    // 원격은 rowPageOrder 를 모르므로 로컬 본을 보존(없으면 [] 로 초기화).
    const rowPageOrder = local?.rowPageOrder ?? [];

    const bundle: DatabaseBundle = {
      meta: {
        id: d.id,
        title: d.title,
        createdAt: isoToMs(d.createdAt) || Date.now(),
        updatedAt: isoToMs(d.updatedAt) || Date.now(),
      },
      columns,
      rowPageOrder,
    };
    return { ...s, databases: { ...s.databases, [d.id]: bundle } };
  });
}

