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

## 데스크톱 릴리스/자동 업데이트

- 태그 릴리스 트리거: `v*` (`v2.0.1` 형태).
- 워크플로우에서 아래 불일치 시 즉시 실패한다.
  - `package.json.version` !== `src-tauri/tauri.conf.json.version`
  - 태그 버전(`v` 제외) !== `package.json.version`
- 태그 생성 전 체크리스트
  - `CHANGELOG.md` 업데이트
  - GitHub Secrets 설정 확인
    - `TAURI_SIGNING_PRIVATE_KEY`
    - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - `src-tauri/tauri.conf.json`의 updater endpoint/pubkey 유효성 확인

### E2E 검증 시나리오 (mac/windows)

1. 기존 버전(`X.Y.Z`) 설치 상태를 준비한다.
2. 버전을 `X.Y.Z+1`로 올리고 태그 `vX.Y.Z+1`를 푸시한다.
3. GitHub Release 자산에 `latest.json`이 포함됐는지 확인한다.
4. 앱 실행 후 업데이트 모달 노출 → 다운로드 진행률 → 재시작 적용까지 확인한다.
5. 재실행 후 앱 버전이 `X.Y.Z+1`로 변경됐는지 확인한다.
