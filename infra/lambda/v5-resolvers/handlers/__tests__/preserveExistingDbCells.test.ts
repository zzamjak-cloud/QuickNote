import { describe, it, expect } from "vitest";
import {
  hasMeaningfulDbCells,
  preserveExistingDbCellsForNullInput,
} from "../pageDatabase";

// 서버 dbCells 백스톤: 협업 비-셀 업서트의 null dbCells 가 기존 셀을 비우지 못하게 보존하되,
// 권위적 셀 상태(객체, 빈 {} 로 "모두 비움" 포함)는 그대로 적용한다.
// null(="건드리지 마") vs {}(="모두 비움") 구분이 핵심.

const CELLS = JSON.stringify({ col1: "값", col2: 3 });
const EMPTY = JSON.stringify({});

describe("hasMeaningfulDbCells", () => {
  it("키 1개 이상 객체만 true", () => {
    expect(hasMeaningfulDbCells(CELLS)).toBe(true);
    expect(hasMeaningfulDbCells({ a: 1 })).toBe(true);
  });
  it("빈 객체/null/비객체는 false", () => {
    expect(hasMeaningfulDbCells(EMPTY)).toBe(false);
    expect(hasMeaningfulDbCells(null)).toBe(false);
    expect(hasMeaningfulDbCells(undefined)).toBe(false);
    expect(hasMeaningfulDbCells("not json")).toBe(false);
  });
});

describe("preserveExistingDbCellsForNullInput", () => {
  it("dbCells null + 기존 셀 있음 → 기존 셀 보존(협업 비셀 업서트 보호)", () => {
    const input: Record<string, unknown> = { id: "p1", dbCells: null };
    preserveExistingDbCellsForNullInput(input, { id: "p1", dbCells: CELLS });
    expect(input.dbCells).toBe(CELLS);
  });

  it("dbCells 키 부재 + 기존 셀 있음 → 보존", () => {
    const input: Record<string, unknown> = { id: "p1", title: "t" };
    preserveExistingDbCellsForNullInput(input, { id: "p1", dbCells: CELLS });
    expect(input.dbCells).toBe(CELLS);
  });

  it("권위적 셀(객체 문자열) 입력은 그대로 적용(셀 편집)", () => {
    const next = JSON.stringify({ col1: "새값" });
    const input: Record<string, unknown> = { id: "p1", dbCells: next };
    preserveExistingDbCellsForNullInput(input, { id: "p1", dbCells: CELLS });
    expect(input.dbCells).toBe(next);
  });

  it("빈 {} 입력은 그대로 적용(모두 비움 정상 동작) — 보존 안 함", () => {
    const input: Record<string, unknown> = { id: "p1", dbCells: EMPTY };
    preserveExistingDbCellsForNullInput(input, { id: "p1", dbCells: CELLS });
    expect(input.dbCells).toBe(EMPTY);
  });

  it("기존 셀이 비어있으면 null 입력에도 보존할 것 없음", () => {
    const input: Record<string, unknown> = { id: "p1", dbCells: null };
    preserveExistingDbCellsForNullInput(input, { id: "p1", dbCells: EMPTY });
    expect(input.dbCells).toBeNull();
  });

  it("신규 페이지(existing=null)는 보존 안 함", () => {
    const input: Record<string, unknown> = { id: "p1", dbCells: null };
    preserveExistingDbCellsForNullInput(input, null);
    expect(input.dbCells).toBeNull();
  });
});
