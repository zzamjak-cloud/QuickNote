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

## 주요 설정 파일
| 파일 | 용도 |
|------|------|
| `package.json` | 의존성, 버전 |
| `src-tauri/tauri.conf.json` | Tauri 설정 및 앱 버전 |
| `infra/` | CDK 인프라 코드 |
| `.npmrc` | `legacy-peer-deps=true` (Vercel 빌드 필수) |
| `vite.config.ts` | Vite 빌드 설정 |
