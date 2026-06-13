#!/usr/bin/env node
// package.json 과 src-tauri/tauri.conf.json 의 version 을 한 번에 맞춘다.
// 두 값 불일치는 Publish Release 워크플로우(validate tag/version sync)를 실패시키므로,
// 수동 2중 수정 대신 이 스크립트로 동기화한다.
//
// 사용법:
//   node scripts/bump-version.mjs 5.4.42     # 지정 버전으로 설정
//   node scripts/bump-version.mjs patch      # 현재 patch +1
//   node scripts/bump-version.mjs minor      # minor +1, patch=0
//   node scripts/bump-version.mjs major      # major +1, minor=patch=0
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const tauriPath = join(root, "src-tauri", "tauri.conf.json");

const SEMVER = /^\d+\.\d+\.\d+$/;

function nextVersion(current, arg) {
  if (SEMVER.test(arg)) return arg;
  const [maj, min, pat] = current.split(".").map((n) => parseInt(n, 10));
  if (arg === "patch") return `${maj}.${min}.${pat + 1}`;
  if (arg === "minor") return `${maj}.${min + 1}.0`;
  if (arg === "major") return `${maj + 1}.0.0`;
  throw new Error(`알 수 없는 인자: ${arg} (x.y.z | patch | minor | major)`);
}

const arg = process.argv[2];
if (!arg) {
  console.error("사용법: node scripts/bump-version.mjs <x.y.z|patch|minor|major>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const next = nextVersion(pkg.version, arg);

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// tauri.conf.json 은 "version" 키만 교체(다른 포맷/주석 보존 위해 정밀 치환).
const tauriRaw = readFileSync(tauriPath, "utf8");
const replaced = tauriRaw.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`);
if (replaced === tauriRaw) {
  console.error("tauri.conf.json 의 version 필드를 찾지 못했습니다.");
  process.exit(1);
}
writeFileSync(tauriPath, replaced);

console.log(`버전 ${pkg.version === next ? "" : ""}${next} 로 동기화 완료 (package.json + tauri.conf.json).`);
console.log(`다음: git add package.json src-tauri/tauri.conf.json && git commit -m "chore: 버전 ${next} bump"`);
