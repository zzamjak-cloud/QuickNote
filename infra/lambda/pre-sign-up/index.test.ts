import { describe, it, expect, beforeEach } from "vitest";
import type { PreSignUpTriggerEvent } from "aws-lambda";
import { handler, isAllowed } from "./index";

function makeEvent(
  email: string,
  triggerSource: PreSignUpTriggerEvent["triggerSource"] = "PreSignUp_ExternalProvider",
): PreSignUpTriggerEvent {
  return {
    version: "1",
    region: "ap-northeast-2",
    userPoolId: "pool",
    userName: "user",
    callerContext: { awsSdkVersion: "1", clientId: "client" },
    triggerSource,
    request: {
      userAttributes: { email },
      validationData: undefined,
      clientMetadata: undefined,
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  } as PreSignUpTriggerEvent;
}

describe("PreSignUp Lambda", () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = "alice@example.com,bob@example.com";
  });

  it("isAllowed 는 대소문자/공백을 무시한다", () => {
    const list = new Set(["alice@example.com"]);
    expect(isAllowed(" Alice@example.com ", list)).toBe(true);
    expect(isAllowed("eve@example.com", list)).toBe(false);
    expect(isAllowed(undefined, list)).toBe(false);
  });

  it("허용 이메일은 자동 확인된다", async () => {
    const event = makeEvent("alice@example.com");
    const result = await handler(event, {} as never, () => undefined);
    if (!result) throw new Error("no result");
    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
  });

  it("미허용 이메일은 가입을 거부한다", async () => {
    const event = makeEvent("eve@example.com");
    await expect(handler(event, {} as never, () => undefined)).rejects.toThrow(
      "UNAUTHORIZED_EMAIL",
    );
  });

  it("ALLOWED_EMAILS 가 비어있으면 모두 거부된다", async () => {
    process.env.ALLOWED_EMAILS = "";
    const event = makeEvent("alice@example.com");
    await expect(handler(event, {} as never, () => undefined)).rejects.toThrow();
  });
});
