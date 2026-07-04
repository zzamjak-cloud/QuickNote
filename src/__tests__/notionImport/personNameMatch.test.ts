import { describe, it, expect } from "vitest";
import type { Member } from "../../store/memberStore";
import {
  normalizeImportedPersonName,
  resolveImportedPersonMemberId,
} from "../../lib/notionImport/personName";

// 멤버명은 조합형(NFC)로 저장, 노션/맥OS 내보내기 작성자명은 분해형(NFD)로 들어오는 상황 재현
const NFC = "홍길동".normalize("NFC");
const NFD = "홍길동".normalize("NFD");

const member = (over: Partial<Member> = {}): Member =>
  ({
    memberId: "m-hong",
    name: NFC,
    email: "hong@x.com",
    status: "active",
    ...over,
  }) as Member;

describe("normalizeImportedPersonName", () => {
  it("NFD/NFC 를 동일 문자열로 정규화한다", () => {
    expect(normalizeImportedPersonName(NFD)).toBe(normalizeImportedPersonName(NFC));
  });

  it("nullish 입력에 크래시하지 않는다", () => {
    expect(normalizeImportedPersonName(undefined as unknown as string)).toBe("");
    expect(normalizeImportedPersonName(null as unknown as string)).toBe("");
  });
});

describe("resolveImportedPersonMemberId — 노션 댓글 작성자 매칭", () => {
  it("NFD 작성자명이 NFC 멤버명과 매칭된다(회귀: 모든 댓글이 임포터 계정으로 떨어짐)", () => {
    const id = resolveImportedPersonMemberId(NFD, [member()], "importer");
    expect(id).toBe("m-hong");
  });

  it("매칭 실패 시에만 fallback(임포터) 을 반환한다", () => {
    const id = resolveImportedPersonMemberId("없는사람", [member()], "importer");
    expect(id).toBe("importer");
  });

  it("이름이 nullish 인 멤버가 섞여 있어도 크래시 없이 매칭한다", () => {
    const members = [member({ memberId: "m-bad", name: null as unknown as string }), member()];
    const id = resolveImportedPersonMemberId(NFD, members, "importer");
    expect(id).toBe("m-hong");
  });
});
