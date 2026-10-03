// 공유 질의 모듈 가드 — infra 가 src/lib/databaseQuery.ts 를 직접 import 하므로, 그 의존 그래프에
// npm·스토어 import 가 들어오면 Lambda 번들·infra tsc 가 깨진다(root node_modules 없이 빌드).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../../../src");
const SHARED = ["lib/databaseQuery.ts", "lib/database/jsonCell.ts", "types/database.ts", "components/database/selectColorPresets.ts"];

describe("infra 가 공유하는 src 모듈", () => {
  it.each(SHARED)("%s 는 상대 경로·공유 목록 안의 모듈만 import 한다", (file) => {
    const text = readFileSync(resolve(SRC, file), "utf8");
    const specs = [...text.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of specs) {
      expect(spec.startsWith(".")).toBe(true);
      const target = resolve(resolve(SRC, file), "..", spec).replace(`${SRC}/`, "").replace(/\.ts$/, "");
      expect(SHARED.map((f) => f.replace(/\.ts$/, ""))).toContain(target);
    }
  });
});
