import { describe, it, expect } from "vitest";
import { normalizeConfirmPhrase } from "../../lib/text/normalizeConfirmPhrase";

describe("normalizeConfirmPhrase", () => {
  it("NFD(자모 분리형)와 NFC(완성형) 한글을 동일하게 정규화한다", () => {
    const nfc = "기술 직군".normalize("NFC");
    const nfd = "기술 직군".normalize("NFD");
    expect(nfc).not.toBe(nfd); // 코드포인트는 다름
    expect(normalizeConfirmPhrase(nfd)).toBe(normalizeConfirmPhrase(nfc));
  });

  it("NBSP·연속 공백을 단일 스페이스로 수렴한다", () => {
    expect(normalizeConfirmPhrase("MEMA 기술  직군")).toBe("MEMA 기술 직군");
  });

  it("zero-width·BOM 등 보이지 않는 문자를 제거한다", () => {
    expect(normalizeConfirmPhrase("기술​직군﻿")).toBe("기술직군");
  });

  it("앞뒤 공백을 제거한다", () => {
    expect(normalizeConfirmPhrase("  데이터베이스 삭제  ")).toBe("데이터베이스 삭제");
  });
});
