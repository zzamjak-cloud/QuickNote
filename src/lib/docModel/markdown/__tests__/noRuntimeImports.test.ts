import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Lambda 번들(esbuild)에는 infra/node_modules 만 존재하므로 런타임 npm import 가 있으면 안 된다.
const RUNTIME_NPM_IMPORT = /^import (?!type)[^;]*from ["'](?!\.)/m;
const RELATIVE_IMPORT = /^(?:import|export) (?!type)[^;]*from ["'](\.[^"']+)["']/gm;
const MARKDOWN_DIR = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolveImport(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // 다음 후보 확인
    }
  }
  throw new Error(`해석 불가 import: ${spec} (${from})`);
}

describe("docModel/markdown 런타임 의존성", () => {
  it("모듈과 그 상대 import 체인 전체에 런타임 npm import 가 없다", () => {
    const seen = new Set<string>();
    const queue = sourceFiles(MARKDOWN_DIR);
    expect(queue.length).toBeGreaterThan(0);
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      expect(RUNTIME_NPM_IMPORT.test(src), file).toBe(false);
      for (const m of src.matchAll(RELATIVE_IMPORT)) queue.push(resolveImport(file, m[1] ?? ""));
    }
    // 상대 경로로 끌어오는 외부 파일(mentionKind 등)도 검사 대상에 포함됐는지 확인
    expect([...seen].some((f) => f.endsWith("mentionKind.ts"))).toBe(true);
  });
});
