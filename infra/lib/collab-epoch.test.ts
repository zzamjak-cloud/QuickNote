import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLLAB_ROOM_EPOCH } from "./collab-epoch";

describe("협업 룸 epoch 서버·클라 기본값 동기", () => {
  it("collabConfig.ts 의 기본 epoch 과 같다", () => {
    const src = readFileSync(path.join(__dirname, "..", "..", "src", "lib", "collab", "collabConfig.ts"), "utf8");
    const match = /VITE_COLLAB_ROOM_EPOCH[^\n]*\|\|\s*"([^"]+)"/.exec(src);
    expect(match?.[1]).toBe(DEFAULT_COLLAB_ROOM_EPOCH);
  });
});

describe("환경별 epoch 해석", () => {
  it("live 는 배포된 클라 epoch(v6), dev 는 기본값, override 가 우선한다", async () => {
    const { resolveCollabRoomEpoch } = await import("./collab-epoch");
    expect(resolveCollabRoomEpoch("")).toBe("v6");
    expect(resolveCollabRoomEpoch("dev-")).toBe(DEFAULT_COLLAB_ROOM_EPOCH);
    expect(resolveCollabRoomEpoch("", "v9")).toBe("v9");
  });
});
