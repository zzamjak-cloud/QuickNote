// 협업 ON DB 의 활성 세션 핸들. databaseStore 가 구조 변경을 Y.Doc 으로 라우팅할 때 사용.
import type { Doc } from "yjs";
import type { DbStructure } from "./dbBundleYjs";

export type DbCollabHandle = {
  doc: Doc;
  /** 직전 materialize 로 store 에 반영한 구조(reconcile 삭제 판정 baseline). */
  baseline: DbStructure;
};

const registry = new Map<string, DbCollabHandle>();

export function registerDbCollab(databaseId: string, handle: DbCollabHandle): void {
  registry.set(databaseId, handle);
}
export function unregisterDbCollab(databaseId: string): void {
  registry.delete(databaseId);
}
export function getDbCollab(databaseId: string): DbCollabHandle | undefined {
  return registry.get(databaseId);
}
export function isDbCollabActive(databaseId: string): boolean {
  return registry.has(databaseId);
}
