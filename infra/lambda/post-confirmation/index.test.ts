import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { linkCognitoSub } from "./index";

type SendFn = typeof DynamoDBDocumentClient.prototype.send;

describe("PostConfirmation Lambda", () => {
  beforeEach(() => {
    process.env.MEMBERS_TABLE_NAME = "quicknote-members";
  });

  it("Member 발견 시 cognitoSub UPDATE 호출", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Items: [{ memberId: "m1", email: "alice@example.com" }] })
      .mockResolvedValueOnce({}) as unknown as SendFn;
    await linkCognitoSub("alice@example.com", "sub-123", "quicknote-members", send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("Member 없으면 throw", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Items: [] }) as unknown as SendFn;
    await expect(
      linkCognitoSub("noone@x.com", "sub", "quicknote-members", send),
    ).rejects.toThrow(/Member not found/);
  });
});
