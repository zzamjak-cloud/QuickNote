import { describe, it, expect, vi } from "vitest";

// 모듈 레벨 CognitoJwtVerifier.create 가 env 없이 throw 하므로 mock 처리
vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: { create: vi.fn().mockReturnValue({ verify: vi.fn() }) },
}));

import { parseRoom } from "../auth";

describe("parseRoom", () => {
  it("db: prefix 는 database room", () => {
    expect(parseRoom("db:abc")).toEqual({ kind: "database", id: "abc" });
  });
  it("prefix 없으면 page room", () => {
    expect(parseRoom("pg-1")).toEqual({ kind: "page", id: "pg-1" });
  });
  it("epoch 솔트(v<N>:)는 page id 에서 제거된다", () => {
    expect(parseRoom("v2:pg-1")).toEqual({ kind: "page", id: "pg-1" });
    expect(parseRoom("v10:pg-1")).toEqual({ kind: "page", id: "pg-1" });
  });
  it("db room 의 epoch 솔트도 id 에서 제거된다", () => {
    expect(parseRoom("db:v2:abc")).toEqual({ kind: "database", id: "abc" });
  });
  it("v 로 시작하는 일반 id 는 솔트로 오인하지 않는다(콜론 없음)", () => {
    expect(parseRoom("v2page")).toEqual({ kind: "page", id: "v2page" });
  });
});
