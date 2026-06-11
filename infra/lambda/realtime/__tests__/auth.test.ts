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
});
