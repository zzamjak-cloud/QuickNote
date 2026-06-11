// DatabaseBundle 의 "구조"(columns·presets·panelState·rowPageOrder) ↔ Y.Doc 제네릭 변환.
// 순수 JSON 만 다룬다(객체→Y.Map, 배열→Y.Array, 원시값 그대로) → 최대 병합 granularity.
import * as Y from "yjs";

export const DB_ROOT_KEY = "db";

export type DbStructure = {
  columns: unknown[];
  presets: unknown[];
  panelState: Record<string, unknown>;
  rowPageOrder: string[];
};

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// JSON → Y 타입(깊은 변환). reconcile 에서 재사용 위해 export.
export function jsonToY(value: Json): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    arr.push(value.map((v) => jsonToY(v)));
    return arr;
  }
  if (value !== null && typeof value === "object") {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) map.set(k, jsonToY(v as Json));
    return map;
  }
  return value;
}

// Y 타입 → JSON(깊은 변환). reconcile 에서 재사용 위해 export.
export function yToJson(value: unknown): Json {
  if (value instanceof Y.Array) return value.toArray().map((v) => yToJson(v));
  if (value instanceof Y.Map) {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of value.entries()) out[k] = yToJson(v);
    return out;
  }
  return value as Json;
}

/** 빈 Y.Doc 에 구조를 1회 시드. 이미 시드돼 있으면 no-op(권위 시드·중복 방지). */
export function seedDbStructure(doc: Y.Doc, structure: DbStructure): void {
  const root = doc.getMap(DB_ROOT_KEY);
  if (root.size > 0) return;
  doc.transact(() => {
    root.set("columns", jsonToY(structure.columns as Json));
    root.set("presets", jsonToY(structure.presets as Json));
    root.set("panelState", jsonToY(structure.panelState as Json));
    root.set("rowPageOrder", jsonToY(structure.rowPageOrder as Json));
  });
}

/** Y.Doc → DbStructure(materialize). 누락 키는 빈 기본값. */
export function readDbStructure(doc: Y.Doc): DbStructure {
  const root = doc.getMap(DB_ROOT_KEY);
  return {
    columns: (yToJson(root.get("columns")) as unknown[]) ?? [],
    presets: (yToJson(root.get("presets")) as unknown[]) ?? [],
    panelState: (yToJson(root.get("panelState")) as Record<string, unknown>) ?? {},
    rowPageOrder: (yToJson(root.get("rowPageOrder")) as string[]) ?? [],
  };
}
