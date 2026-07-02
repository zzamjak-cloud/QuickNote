import { describe, it, expect } from "vitest";
import { handler, isAwarenessMessage } from "../sync";
import { parseClientMessage, encodeBytes } from "../protocol";

describe("sync awareness 분기", () => {
  it("awareness 메시지는 영속 대상이 아니다(isAwarenessMessage=true)", () => {
    const msg = parseClientMessage(JSON.stringify({ t: "awareness", update: encodeBytes(new Uint8Array([1])) }));
    expect(msg).not.toBeNull();
    expect(isAwarenessMessage(msg!)).toBe(true);
  });

  it("update 메시지는 영속 대상이다(isAwarenessMessage=false)", () => {
    const msg = parseClientMessage(JSON.stringify({ t: "update", update: encodeBytes(new Uint8Array([1])) }));
    expect(isAwarenessMessage(msg!)).toBe(false);
  });
});

describe("sync keepalive ping", () => {
  it("ping 은 커넥션 조회·상태 로드 없이 즉시 200 을 반환한다", async () => {
    // DDB 를 mock 하지 않으므로, ping 분기를 지나쳐 커넥션 조회로 진입하면 실패한다.
    const res = await handler(
      {
        body: JSON.stringify({ t: "ping" }),
        requestContext: { connectionId: "c1", domainName: "d", stage: "dev" },
      } as never,
      {} as never,
      () => {},
    );
    expect((res as { statusCode: number }).statusCode).toBe(200);
  });
});
