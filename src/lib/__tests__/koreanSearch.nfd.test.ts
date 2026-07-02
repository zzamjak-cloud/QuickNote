import { describe, expect, it } from "vitest";
import { koreanIncludes, koreanMatchScore } from "../koreanSearch";

// 회귀: macOS 등에서 제목이 분해형(NFD)으로 저장되고 입력은 조합형(NFC)으로 들어오면
// 코드포인트가 달라 부분일치가 실패했다(메모리: 한글 검색 NFD/NFC 불일치).
// koreanMatchScore 가 양쪽을 NFC 로 정규화하므로 NFD 저장 제목도 매칭돼야 한다.
describe("koreanSearch NFD/NFC 정규화 회귀", () => {
  const NFC = "한글";
  const NFD = "한글".normalize("NFD"); // 자모 분해형

  it("사전조건: NFC 와 NFD 는 코드포인트 길이가 다르다(테스트가 유효한지 확인)", () => {
    expect(NFC).not.toBe(NFD);
    expect(NFD.length).toBeGreaterThan(NFC.length);
  });

  it("NFD 로 저장된 제목을 NFC 입력으로 완전일치한다", () => {
    expect(koreanMatchScore(NFD, NFC)).toBeGreaterThan(0);
  });

  it("NFD 저장 제목의 부분일치(포함)도 성공한다", () => {
    const titleNfd = "우리 한글 노트".normalize("NFD");
    expect(koreanIncludes(titleNfd, "한글")).toBe(true);
  });

  it("NFC 입력이 NFD 부분문자열을 startsWith 로도 찾는다", () => {
    const titleNfd = "한글날 특집".normalize("NFD");
    expect(koreanMatchScore(titleNfd, "한글날")).toBeGreaterThan(0);
  });

  it("반대 방향: NFC 저장 + NFD 입력도 매칭된다", () => {
    expect(koreanMatchScore(NFC, NFD)).toBeGreaterThan(0);
  });

  it("무관한 질의는 여전히 매칭되지 않는다", () => {
    expect(koreanIncludes("한글".normalize("NFD"), "영어")).toBe(false);
  });
});
