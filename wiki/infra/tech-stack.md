# 기술 스택

## 프론트엔드
- React + TypeScript + Vite
- Tailwind CSS + Radix UI
- TipTap (ProseMirror 기반 에디터)
- Zustand (persist 미들웨어)

## 백엔드/인프라
- AWS AppSync (GraphQL API)
- AWS Lambda (Node.js)
- AWS CDK (`infra/` 디렉토리)

## 로컬 스토리지
- 웹: localStorage
- 네이티브(Tauri): SQLite

## 동기화
- LWW(Last-Write-Wins) + IndexedDB outbox 큐

## 네이티브
- Tauri (데스크탑 앱 래퍼, `src-tauri/`)

## 관측성
- 비치명 에러는 `reportNonFatal(err, context)` 로 보고한다 (`src/lib/reportNonFatal.ts`).
- 자세한 보관/전송 동작은 [observability.md](observability.md) 참고.

## 공통 util 단일 출처
중복 구현 통합 — 새 코드는 반드시 아래에서 import (재구현 금지).

| 함수 | 단일 출처 |
|------|-----------|
| `isRecord` | `src/lib/util/typeGuards.ts:4` |
| `formatError` | `src/lib/util/formatError.ts:2` |
| `stringifyAwsJson` (write 측) | `src/lib/util/awsJson.ts:7` |
| `parseAwsJson` (read 측) | `src/lib/sync/storeApply/helpers.ts` |
| `requireEnv` (Lambda) | `infra/lambda/_shared/env.ts:3` |

## 주요 설정 파일
| 파일 | 용도 |
|------|------|
| `package.json` | 의존성, 버전 |
| `src-tauri/tauri.conf.json` | Tauri 설정 및 앱 버전(라이브 빌드) |
| `src-tauri/tauri.dev.conf.json` | dev 전용 오버라이드(identifier·productName 분리 → 로컬 캐시 격리). [observability.md](observability.md) 참고 |
| `infra/` | CDK 인프라 코드 |
| `.npmrc` | `legacy-peer-deps=true` (Vercel 빌드 필수) |
| `vite.config.ts` | Vite 빌드 설정 + manualChunks 룰. 번들 분리는 [bundle.md](bundle.md) |
| `scripts/bump-version.mjs` | package.json↔tauri.conf.json 버전 동기화 (`npm run bump`) |
