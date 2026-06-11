// 협업 ON DB 의 로컬 새 구조를 Y.Doc 에 안전하게 반영(baseline 기반 레이스 보호).
import * as Y from "yjs";
import { DB_ROOT_KEY, jsonToY, type DbStructure, type Json } from "./dbBundleYjs";

type IdObj = { id: string; [k: string]: unknown };

// id 필드를 가진 객체만 추출
function asIdObjs(arr: unknown[]): IdObj[] {
  return arr.filter((x): x is IdObj => !!x && typeof x === "object" && typeof (x as IdObj).id === "string");
}

// Y 타입을 순수 JS 값으로 변환(비교용)
function yToPlain(v: unknown): unknown {
  if (v instanceof Y.Array) return v.toArray().map(yToPlain);
  if (v instanceof Y.Map) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of v.entries()) o[k] = yToPlain(x);
    return o;
  }
  return v;
}

// id 동일성 reconcile: local-new 기준 add/update, baseline 으로 삭제 disambiguate.
// - Y에 있고 local-new에도 있으면 → 필드 업데이트
// - Y에 있고 local-new에 없고 baseline에 있으면 → 로컬 삭제 → Y에서 제거
// - Y에 있고 local-new에 없고 baseline에도 없으면 → 원격 신규 → 유지(레이스 보호)
function reconcileById(
  yArr: Y.Array<Y.Map<unknown>>,
  localItems: IdObj[],
  baselineItems: IdObj[],
): void {
  const localById = new Map(localItems.map((c) => [c.id, c]));
  const baselineIds = new Set(baselineItems.map((c) => c.id));

  // 역순으로 순회해 삭제 인덱스 안전 처리
  for (let i = yArr.length - 1; i >= 0; i--) {
    const ym = yArr.get(i) as Y.Map<unknown>;
    const id = ym.get("id") as string;
    const local = localById.get(id);
    if (local) {
      // 이미 Y에 있고 local에도 있음 → 필드 업데이트
      for (const [k, v] of Object.entries(local)) {
        if (JSON.stringify(yToPlain(ym.get(k))) !== JSON.stringify(v)) {
          ym.set(k, jsonToY(v as Json));
        }
      }
      localById.delete(id);
    } else if (baselineIds.has(id)) {
      // baseline에 있었는데 local-new에서 사라짐 → 로컬 삭제
      yArr.delete(i, 1);
    }
    // 그 외(Y에만 있고 baseline에도 없음) → 원격 신규이므로 유지
  }

  // local-new에만 있는 항목(Y에 없던 것) → 추가
  for (const item of localById.values()) {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(item)) m.set(k, jsonToY(v as Json));
    yArr.push([m]);
  }
}

/** localNew 구조를 Y.Doc 에 반영. baseline 은 직전 materialize 구조(삭제 판정용). */
export function reconcileStructureIntoYDoc(
  doc: Y.Doc,
  localNew: DbStructure,
  baseline: DbStructure,
): void {
  const root = doc.getMap(DB_ROOT_KEY);
  doc.transact(() => {
    // columns·presets: id 기반 reconcile
    reconcileById(
      root.get("columns") as Y.Array<Y.Map<unknown>>,
      asIdObjs(localNew.columns),
      asIdObjs(baseline.columns),
    );
    reconcileById(
      root.get("presets") as Y.Array<Y.Map<unknown>>,
      asIdObjs(localNew.presets),
      asIdObjs(baseline.presets),
    );

    // panelState: Y.Map 키 수준 병합(field merge)
    const panel = root.get("panelState") as Y.Map<unknown>;
    for (const [k, v] of Object.entries(localNew.panelState)) {
      if (JSON.stringify(yToPlain(panel.get(k))) !== JSON.stringify(v)) {
        panel.set(k, jsonToY(v as Json));
      }
    }
    // local-new 에 없는 키 제거
    for (const k of [...panel.keys()]) {
      if (!(k in localNew.panelState)) panel.delete(k);
    }

    // rowPageOrder: 배열 전체 교체
    const order = root.get("rowPageOrder") as Y.Array<string>;
    order.delete(0, order.length);
    order.push(localNew.rowPageOrder);
  });
}
