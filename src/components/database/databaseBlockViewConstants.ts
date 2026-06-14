import type { Table2 } from "lucide-react";
import type { ColumnDef, ViewKind } from "../../types/database";
import { DATABASE_VIEW_ORDER, DATABASE_VIEW_REGISTRY } from "./databaseViewRegistry";

// 아래 상수/함수는 모두 단일 등록점(databaseViewRegistry)에서 파생한다.
export const VIEW_ICONS: Record<ViewKind, typeof Table2> = Object.fromEntries(
  DATABASE_VIEW_ORDER.map((kind) => [kind, DATABASE_VIEW_REGISTRY[kind].icon]),
) as Record<ViewKind, typeof Table2>;

/** 뷰 토글 라벨(한국어). */
export const VIEW_LABELS: Record<ViewKind, string> = Object.fromEntries(
  DATABASE_VIEW_ORDER.map((kind) => [kind, DATABASE_VIEW_REGISTRY[kind].label]),
) as Record<ViewKind, string>;

/** 현재 컬럼 구성에서 선택 불가한 뷰 모드 계산 */
export function getUnavailableViewKinds(columns: ColumnDef[]): ViewKind[] {
  return DATABASE_VIEW_ORDER.filter((kind) => !DATABASE_VIEW_REGISTRY[kind].isAvailable(columns));
}
