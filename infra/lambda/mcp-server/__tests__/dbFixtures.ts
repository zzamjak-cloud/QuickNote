// DB 툴 테스트 픽스처 — 컬럼·행·시드된 DB 룸(서버 dbSeed 와 같은 구조).
import * as Y from "yjs";
import { jsonToY } from "../../realtime/dbSeed";
import type { Item } from "./fakeDdb";
import { baseTables, makeCtx } from "./fixtures";
import { docOf, para, rooms } from "./collabMocks";

export const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };

export const COLUMNS = [
  { id: "c-title", name: "Name", type: "title" },
  { id: "c-status", name: "Status", type: "status", config: { options: [{ id: "o-todo", label: "Todo" }, { id: "o-done", label: "Done" }] } },
  { id: "c-tags", name: "Tags", type: "multiSelect", config: { options: [{ id: "t-red", label: "red" }, { id: "t-blue", label: "blue" }] } },
  { id: "c-pts", name: "Points", type: "number" },
  { id: "c-due", name: "Due", type: "date" },
  { id: "c-owner", name: "Owner", type: "person" },
  { id: "c-ok", name: "Done?", type: "checkbox" },
  { id: "c-note", name: "Note", type: "text" },
];

export function row(id: string, title: string, order: number, cells: Item = {}, extra: Item = {}): Item {
  return {
    id, workspaceId: "ws-a", databaseId: "db1", title, order: String(order), parentId: null,
    updatedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
    dbCells: JSON.stringify(cells), doc: JSON.stringify(docOf(para(`body ${title}`, `blk-${id}`))), ...extra,
  };
}

export const ROWS: Item[] = [
  row("r1", "Alpha", 1, { "c-status": "o-todo", "c-tags": ["t-red"], "c-pts": 5, "c-due": { start: "2026-10-01" }, "c-owner": ["m1"], "c-ok": true }),
  row("r2", "Beta", 2, { "c-status": "o-done", "c-tags": ["t-blue", "t-red"], "c-pts": 12, "c-due": { start: "2026-09-15" }, "c-owner": ["m2"] }),
  row("r3", "Gamma", 10, { "c-status": "o-todo", "c-pts": 1, "c-note": "urgent fix" }),
  row("r4", "Delta", 9, { "c-pts": 7 }),
  row("tpl", "Template", 3, { _qn_isTemplate: "1" }),
];

export function setupDb(opts: { rows?: Item[]; token?: object; extraPages?: Item[] } = {}) {
  const tables = baseTables();
  tables["workspace-access"].push({ workspaceId: "ws-a", subjectKey: "member#m2", subjectType: "member", subjectId: "m2", level: "view" });
  tables.databases = [{
    id: "db1", workspaceId: "ws-a", title: "Tasks", columns: JSON.stringify(COLUMNS), createdByMemberId: "m1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  tables.pages = [...(opts.rows ?? ROWS), ...(opts.extraPages ?? [])].map((p) => ({ ...p }));
  return makeCtx(tables, (opts.token ?? WRITE) as never);
}

/** 서버 dbSeed 와 같은 구조로 DB 룸을 시드한다. */
export function seedDbRoom(databaseId: string, structure: { columns: unknown[]; rows: Record<string, Item>; order: string[]; members?: string[] }) {
  const doc = new Y.Doc();
  const root = doc.getMap("db");
  doc.transact(() => {
    root.set("columns", jsonToY(structure.columns));
    root.set("presets", jsonToY([]));
    root.set("panelState", jsonToY({}));
    root.set("rowPageOrder", jsonToY(structure.order));
    root.set("rows", jsonToY(structure.rows));
    root.set("rowMembers", jsonToY(structure.members ?? structure.order));
  });
  rooms.set(`db:v5:${databaseId}`, Y.encodeStateAsUpdate(doc));
}

export function readDbRoom(databaseId: string): Record<string, unknown> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, rooms.get(`db:v5:${databaseId}`) ?? new Uint8Array([0, 0]));
  return doc.getMap("db").toJSON() as Record<string, unknown>;
}
