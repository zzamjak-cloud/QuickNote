import { describe, it, expect } from "vitest";
import { newId } from "../lib/id";

describe("newId", () => {
  it("uuid v4 형식의 36자 문자열을 반환", () => {
    const id = newId();
    expect(id).toHaveLength(36);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("호출마다 다른 id를 반환", () => {
    expect(newId()).not.toBe(newId());
  });
});
