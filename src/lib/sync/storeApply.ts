// 원격(GraphQL) 변경을 로컬 zustand 스토어에 LWW 로 적용한다.
// - GraphQL 쪽은 ISO 문자열, 로컬 스토어는 epoch ms(number) — 경계에서 변환.
// - tombstone(deletedAt != null) 이면 로컬에서 제거.
// - 로컬이 더 신선하면 무시(LWW).

import type {
  GqlPage,
  GqlDatabase,
  GqlContact,
} from "./graphql/operations";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useContactsStore, type Contact } from "../../store/contactsStore";
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
      doc: (p.doc as JSONContent | null) ?? { type: "doc", content: [{ type: "paragraph" }] },
      parentId: p.parentId ?? null,
      order: orderNum,
      databaseId: p.databaseId ?? undefined,
      dbCells: (p.dbCells as Page["dbCells"]) ?? undefined,
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

    const columns = (d.columns as ColumnDef[] | null) ?? [];
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

export function applyRemoteContactToStore(
  c: GqlContact | null | undefined,
): void {
  if (!c) return;
  useContactsStore.setState((s) => {
    const idx = s.contacts.findIndex((x) => x.id === c.id);
    const local = idx >= 0 ? s.contacts[idx] : undefined;
    if (c.deletedAt) {
      if (!local) return s;
      return { contacts: s.contacts.filter((x) => x.id !== c.id) };
    }
    if (local && !isRemoteNewer(local.updatedAt, c.updatedAt)) return s;

    const merged: Contact = {
      id: c.id,
      email: c.email,
      displayName: c.displayName,
      createdAt: isoToMs(c.createdAt) || Date.now(),
      updatedAt: isoToMs(c.updatedAt) || Date.now(),
    };
    if (idx === -1) {
      return { contacts: [...s.contacts, merged] };
    }
    const next = s.contacts.slice();
    next[idx] = merged;
    return { contacts: next };
  });
}
