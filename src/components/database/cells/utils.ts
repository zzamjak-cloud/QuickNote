// 데이터베이스 셀 공통 유틸 — 순수 함수만 모음.
// DatabaseCell.tsx 에서 분리 — 동작 변경 없음.

import { SELECT_COLOR_PRESETS } from "../ColumnOptionsEditor";

export function toDate(iso: string): Date {
  return new Date(iso);
}

export function toIsoStart(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00`;
}

export function toIsoEnd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T23:59:59`;
}

export function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatDate(d: Date): string {
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}. ${mm}. ${dd}`;
}

/** 콤마/줄바꿈 구분 문자열 또는 배열을 칩 배열로 정규화. */
export function normalizePersonValue(
  v: string | string[] | null | undefined,
): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    // 기존 데이터가 "이름1,이름2" 형태로 저장된 경우 분리
    return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** select 칩과 동일한 고정 컬러 배열 — 이름 첫 글자 코드로 배정. */
export const PERSON_CHIP_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
];

export function personChipColor(name: string): string {
  return (
    PERSON_CHIP_COLORS[Math.abs(name.charCodeAt(0)) % PERSON_CHIP_COLORS.length] ??
    PERSON_CHIP_COLORS[0]!
  );
}

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function optionStyle(color: string | undefined) {
  return { backgroundColor: color ?? SELECT_COLOR_PRESETS[0] };
}
