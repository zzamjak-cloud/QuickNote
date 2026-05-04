# 기여 가이드

## 개발 환경

- **Node.js**: `package.json`의 `engines` 및 저장소 루트 `.nvmrc` 참고 (권장 **20 LTS**).
- 패키지 매니저: **npm** (`package-lock.json` 기준).

```bash
npm ci
npm run dev
```

## 검증 (PR 전)

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## 코드 스타일

- TypeScript **strict**, ESLint 규칙 준수.
- 사용자 대면 문자열은 프로젝트 기존 관행에 맞출 것 (한국어 UI 등).

## 보안

취약점은 `SECURITY.md` 절차로 비공개 신고해 주세요.

## 커밋

Conventional Commits 권장 (`feat:`, `fix:`, `chore:` …). 자동 릴리스/release-please는 아직 연결되어 있지 않을 수 있습니다.
