import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatPhone,
  normalizePersonValue,
  personChipColor,
  sameDay,
  stripTime,
  toDate,
  toIsoEnd,
  toIsoStart,
} from "../utils";

describe("cells/utils", () => {
  describe("formatPhone", () => {
    it("3자리 미만은 그대로", () => {
      expect(formatPhone("01")).toBe("01");
    });
    it("4~7자리는 3-N 형태", () => {
      expect(formatPhone("01012")).toBe("010-12");
    });
    it("8~11자리는 3-4-N 형태", () => {
      expect(formatPhone("01012345678")).toBe("010-1234-5678");
    });
    it("11자리 초과는 절단", () => {
      expect(formatPhone("0101234567899")).toBe("010-1234-5678");
    });
    it("비숫자는 제거", () => {
      expect(formatPhone("a01b0-12c34")).toBe("010-1234");
    });
  });

  describe("normalizePersonValue", () => {
    it("배열은 빈 항목 제거", () => {
      expect(normalizePersonValue(["a", "", "b"])).toEqual(["a", "b"]);
    });
    it("콤마 구분 문자열은 분리", () => {
      expect(normalizePersonValue("홍길동, 이순신")).toEqual(["홍길동", "이순신"]);
    });
    it("줄바꿈 구분 문자열은 분리", () => {
      expect(normalizePersonValue("홍길동\n이순신")).toEqual(["홍길동", "이순신"]);
    });
    it("null/undefined/빈 문자열은 빈 배열", () => {
      expect(normalizePersonValue(null)).toEqual([]);
      expect(normalizePersonValue(undefined)).toEqual([]);
      expect(normalizePersonValue("")).toEqual([]);
    });
  });

  describe("personChipColor", () => {
    it("같은 이름은 같은 색을 반환한다 (안정적 매핑)", () => {
      expect(personChipColor("홍길동")).toBe(personChipColor("홍길동"));
    });
    it("빈 문자열도 색을 반환한다 (fallback)", () => {
      expect(personChipColor("")).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe("date helpers", () => {
    it("toIsoStart/End 는 자정/23:59:59 ISO 반환", () => {
      const d = new Date(2026, 4, 15); // 2026-05-15
      expect(toIsoStart(d)).toBe("2026-05-15T00:00:00");
      expect(toIsoEnd(d)).toBe("2026-05-15T23:59:59");
    });

    it("stripTime 은 시/분/초/ms 제거", () => {
      const d = new Date(2026, 4, 15, 13, 45, 30);
      const s = stripTime(d);
      expect(s.getHours()).toBe(0);
      expect(s.getMinutes()).toBe(0);
      expect(s.getSeconds()).toBe(0);
      expect(s.getMilliseconds()).toBe(0);
    });

    it("sameDay 는 시간 차이 무시", () => {
      const a = new Date(2026, 4, 15, 9, 0);
      const b = new Date(2026, 4, 15, 23, 59);
      const c = new Date(2026, 4, 16, 0, 0);
      expect(sameDay(a, b)).toBe(true);
      expect(sameDay(a, c)).toBe(false);
    });

    it("formatDate 는 YY. MM. DD 포맷", () => {
      expect(formatDate(new Date(2026, 0, 5))).toBe("26. 01. 05");
      expect(formatDate(new Date(2099, 11, 31))).toBe("99. 12. 31");
    });

    it("toDate 는 ISO 문자열을 Date 로", () => {
      const d = toDate("2026-05-15T00:00:00");
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(4);
      expect(d.getDate()).toBe(15);
    });
  });
});
