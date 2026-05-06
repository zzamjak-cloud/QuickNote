import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { isMemberAllowed } from "./index";

type SendFn = typeof DynamoDBDocumentClient.prototype.send;

function makeMockSend(items: Record<string, unknown>[]) {
  return vi.fn().mockResolvedValue({ Items: items }) as unknown as SendFn;
}

describe("PreSignUp Lambda", () => {
  beforeEach(() => {
    process.env.MEMBERS_TABLE_NAME = "quicknote-members";
  });

  it("active 멤버는 허용", async () => {
    const send = makeMockSend([{ memberId: "m1", email: "alice@example.com", status: "active" }]);
    expect(await isMemberAllowed("Alice@example.com", "quicknote-members", send)).toBe(true);
  });

  it("removed 멤버는 거부", async () => {
    const send = makeMockSend([{ memberId: "m1", email: "alice@example.com", status: "removed" }]);
    expect(await isMemberAllowed("alice@example.com", "quicknote-members", send)).toBe(false);
  });

  it("Member 가 없으면 거부", async () => {
    const send = makeMockSend([]);
    expect(await isMemberAllowed("eve@example.com", "quicknote-members", send)).toBe(false);
  });

  it("이메일 누락 시 즉시 거부 (DDB 호출 없음)", async () => {
    const send = vi.fn() as unknown as SendFn;
    expect(await isMemberAllowed("", "quicknote-members", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
