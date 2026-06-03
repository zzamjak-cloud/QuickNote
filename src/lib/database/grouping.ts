// 데이터베이스 그룹화 엔진 — 순수 함수 모듈.
// 표/리스트/갤러리(+후속 타임라인) 뷰가 공유하는 그룹 분할 로직을 한곳에 모은다.
// 칸반은 자체 kanbanGroupColumnId 를 사용하므로 이 엔진과 분리되어 있다.

import type { ColumnDef, ColumnType, DatabaseRowView } from "../../types/database";
import {
  extractFilterValueIds,
  filterDisplayOptionsForColumn,
  resolveFilterValueLabel,
  type FilterLabelContext,
} from "./filterValueLabels";
import { personChipColor } from "../../components/database/cells/utils";

/**
 * 그룹화 가능한 컬럼 타입 — 확장 단일 지점.
 * 추후 그룹화 대상 타입을 늘리려면 이 집합에만 추가하면 된다(엔진/뷰 수정 불필요).
 */
export const GROUPABLE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "person",
  "status",
  "select",
]);

/** 값이 없는 행이 모이는 "미지정" 그룹의 키(항상 마지막에 배치). */
export const GROUP_UNASSIGNED = "__ungrouped__";

/** 그룹화 라벨/색 해석에 필요한 컨텍스트 — 필터 라벨 컨텍스트와 동일. */
export type GroupLabelContext = FilterLabelContext;

/** 정렬된 그룹 — 헤더 표시와 행 목록을 함께 담는다. */
export type RowGroup = {
  /** 옵션 id / memberId / GROUP_UNASSIGNED */
  key: string;
  /** 헤더에 표시할 사람이 읽을 수 있는 라벨 */
  label: string;
  /** 헤더 색 점(없으면 중립색). */
  color?: string;
  rows: DatabaseRowView[];
};

/** 해당 컬럼이 그룹화 가능한 타입인지. */
export function isGroupableColumn(col: ColumnDef): boolean {
  return GROUPABLE_COLUMN_TYPES.has(col.type);
}

/** 컬럼 목록에서 그룹화 가능한 컬럼만 추린다(표시 순서 보존). */
export function getGroupableColumns(columns: readonly ColumnDef[]): ColumnDef[] {
  return columns.filter((col) => isGroupableColumn(col));
}

/**
 * 한 행이 속한 그룹 키 배열을 반환한다.
 * - select/status: 단일 키(문자열 id)
 * - person: 다중 키(memberId 배열) — 노션 방식으로 각 그룹에 모두 표시
 * - 값 없음: 빈 배열([]) → 호출부에서 미지정 그룹으로 처리
 */
export function resolveRowGroupKeys(row: DatabaseRowView, col: ColumnDef): string[] {
  return extractFilterValueIds(row.cells[col.id]);
}

/**
 * 행 목록을 그룹 컬럼 기준으로 분할한다.
 * - 그룹 순서: 컬럼 옵션 순서(select/status=config.options, person=멤버 순서) → 옵션에 없는 잔여 키(등장 순) → 미지정(마지막)
 * - 행 순서: 입력 순서(이미 필터·정렬 완료) 보존
 * - person 다중값 행은 자신이 속한 각 그룹에 모두 포함된다(행 중복 허용)
 * - 행이 없는 그룹은 결과에서 제외(v1)
 */
export function buildRowGroups(
  rows: readonly DatabaseRowView[],
  col: ColumnDef,
  ctx: GroupLabelContext,
): RowGroup[] {
  // 옵션 순서·라벨·색 — select/status/person 모두 동일 API 로 해석.
  const orderedOptions = filterDisplayOptionsForColumn(col, ctx);
  const optionById = new Map(orderedOptions.map((o) => [o.id, o]));

  // key -> 누적 행. 옵션 순서를 우선 보존하기 위해 등장 순서를 별도 추적한다.
  const buckets = new Map<string, DatabaseRowView[]>();
  const extraKeyOrder: string[] = []; // 옵션에 없던 잔여 키(등장 순)

  const pushTo = (key: string, row: DatabaseRowView) => {
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
      if (key !== GROUP_UNASSIGNED && !optionById.has(key)) extraKeyOrder.push(key);
    }
    list.push(row);
  };

  for (const row of rows) {
    const keys = resolveRowGroupKeys(row, col);
    if (keys.length === 0) {
      pushTo(GROUP_UNASSIGNED, row);
      continue;
    }
    for (const key of keys) pushTo(key, row);
  }

  const labelFor = (key: string): string => {
    const opt = optionById.get(key);
    if (opt) return opt.label;
    // 여기 도달하는 키는 옵션에 없는 잔여 키뿐이므로(extraKeyOrder), 옵션 맵 fast-path 는 불필요.
    return resolveFilterValueLabel(col, key, ctx);
  };
  const colorFor = (key: string): string | undefined => {
    const opt = optionById.get(key);
    if (opt?.color) return opt.color;
    if (col.type === "person") return personChipColor(key);
    return undefined;
  };

  const result: RowGroup[] = [];
  // 1) 옵션 순서대로(행 있는 그룹만)
  for (const opt of orderedOptions) {
    const list = buckets.get(opt.id);
    if (list && list.length > 0) {
      result.push({ key: opt.id, label: opt.label, color: colorFor(opt.id), rows: list });
    }
  }
  // 2) 옵션에 없던 잔여 키(등장 순)
  for (const key of extraKeyOrder) {
    const list = buckets.get(key);
    if (list && list.length > 0) {
      result.push({ key, label: labelFor(key), color: colorFor(key), rows: list });
    }
  }
  // 3) 미지정(항상 마지막)
  const unassigned = buckets.get(GROUP_UNASSIGNED);
  if (unassigned && unassigned.length > 0) {
    result.push({ key: GROUP_UNASSIGNED, label: "미지정", color: "#94a3b8", rows: unassigned });
  }

  return result;
}
