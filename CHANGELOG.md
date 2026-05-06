# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.1] - 2026-05-06

### Fixed

- 앱 자동 업데이트 직후 등 **`로그인 상태 확인 중…`에서 멈추는 문제** 완화: 세션 복구(`restoreSession`) 전체에 예외 처리 및 타임아웃(토큰 저장소 읽기·`signinSilent`·`getUser`). OIDC 설정 오류 시에도 로딩에 고정되지 않도록 `getOidcManager()` 호출 순서 정리.
- 로그인 화면에 세션 복구 타임아웃 안내 메시지(`restoreTimeout`) 추가.

## [3.0.0] - 2026-05-06

### Added
- AWS Cognito User Pool + Google OAuth 페더레이션 기반 로그인.
- `infra/` CDK(TypeScript) 스택: User Pool, App Client(웹/데스크톱), Hosted UI 도메인, PreSignUp Lambda.
- 화이트리스트 강제: PreSignUp Lambda 트리거가 `ALLOWED_EMAILS` 와 매칭되지 않는 가입을 거부.
- 프론트엔드 `src/lib/auth/`: `oidc-client-ts` 기반 PKCE Authorization Code 흐름, `zustandStorage` 위 비동기 StateStore.
- `useAuthStore` (`src/store/authStore.ts`): `loading / anonymous / authenticated` 상태 머신, refresh_token 기반 silent renew.
- `<AuthGate>` 게이트, `LoginScreen`, `AuthCallback`, `UserMenu` 컴포넌트.
- Tauri 데스크톱 OAuth: 시스템 기본 브라우저 + `quicknote://auth/callback` 딥링크. `tauri-plugin-deep-link`, `tauri-plugin-shell` 추가.
- `.env.example` 와 `infra/README.md` 배포 가이드.

### Changed
- `package.json`/`src-tauri/tauri.conf.json` 버전을 `3.0.0` 으로 bump.
- `App.tsx` 를 `<AuthGate>` 로 감싸 로그인 전에는 메인 UI 가 마운트되지 않도록 변경.
- `main.tsx` 부팅 시 `pathname=/auth/callback` 분기로 토큰 교환 후 `/` 로 전환.
- `TopBar` 우측에 사용자 아바타 + 로그아웃 메뉴 추가.

### Notes
- 데이터 모델은 v2 와 동일(localStorage / SQLite). 사용자별 데이터 분리는 v4 에서 도입 예정.

## [Unreleased pre-3.0.0]

### Added
- 페이지/DB 버전 히스토리 스토어(`historyStore`) 도입: 보관 정책(최대 200개/30일), 앵커 스냅샷, 삭제 행 복원 포인트 관리.
- 페이지 상단 메뉴/행 페이지/사이드 피크에서 공통으로 사용하는 버전 히스토리 모달(다중 선택·일괄 삭제) 추가.
- 사이드바 하단 **데이터베이스 관리** UI 추가: 활성 DB 목록, 삭제 DB 복원, DB 바로 열기.
- 페이지 이동 다이얼로그에서 페이지/DB 통합 검색 및 DB 대상으로의 이동(참조 행 생성) 지원.
- Tauri 자동 업데이트 런타임 추가(`tauri-plugin-updater`, `tauri-plugin-process`) 및 앱 내 업데이트 모달/다운로드/재시작 흐름 도입.

### Changed
- 페이지 아이콘 트리거 UI를 텍스트(`아이콘 추가`)에서 `+` 심볼 아이콘으로 변경.
- 데이터베이스 툴바를 단일 라인으로 정리: 좌측 뷰 모드 토글, 우측 검색/정렬/필터/속성 액션.
- 인라인 데이터베이스 헤더의 중복 드래그 핸들 표시 제거.
- 테이블 헤더의 별도 속성 설정 컬럼을 제거하고 툴바의 속성 버튼으로 통합.
- 테이블 선택 체크박스 열 폭/정렬을 재조정해 컬럼 라인과 겹침을 완화.
- DB/페이지 히스토리 경계를 재정의: 셀 값 변경은 페이지 히스토리로만 기록하고 DB 히스토리에서는 제외.
- 컬럼 이동(`db.column.move`)은 버전 히스토리에 적재하지 않도록 조정.
- 호환되지 않는 과거 DB 히스토리 항목을 DB 타임라인에서 자동 숨김 처리해 복원 시 크래시를 예방.
- DB 히스토리 버튼 위치를 데이터 영역 하단에서 제목행 우측 액션으로 이동.
- 타임라인 뷰 좌측 항목 행에도 hover 액션(전체 페이지 열기/사이드 피크/삭제)을 테이블 뷰와 동일하게 적용.
- `/데이터베이스 > 전체 페이지` 동작을 DB 분리 모델에 맞게 조정: 현재 페이지에는 `@` 멘션만 남기고 DB 전용 페이지는 사이드바에서 숨김.
- DB를 다른 DB 항목으로 이동할 때 실삽입 대신 참조 행으로 처리(중첩 DB 방지).
- 인라인 DB 제목 input에서 텍스트 선택/드래그 시 블록 드래그가 시작되지 않도록 가드 추가.
- 행 전체 페이지 열기 아이콘 `Ctrl/Cmd + 클릭` 시 새 탭 열기, 뒤로가기 시 이전 DB 문맥으로 복귀.
- GitHub Actions 태그 릴리스를 `latest.json` 병합 업로드 방식으로 정비하고, 태그/버전 불일치 시 실패 가드를 추가.

## [2.0.0] - 2026-05-05

### Added
- Tauri 2 데스크톱 앱 이식 — macOS(.dmg) + Windows(.exe/.msi) 배포 빌드
- SQLite 로컬 저장소 (`quicknote.db`) — `tauri-plugin-sql` 기반
- `src/lib/storage/` 어댑터 레이어 — 웹(localStorage) / 데스크톱(SQLite) 자동 분기
- 최초 실행 시 localStorage → SQLite 마이그레이션 UI
- GitHub Actions CI — `v*` 태그 푸시 시 macOS(universal) + Windows 크로스 빌드 + GitHub Release 초안 생성

### Changed
- Zustand persist storage: `localStorage` → `zustandStorage` (환경 감지 어댑터)
- `vite.config.ts`: Tauri 빌드 타겟(`es2021`) 분기, `TAURI_` env prefix 추가

## [1.0.0] - 2026-05-05

### Added

- 데이터베이스 블록: Table·Gallery·Kanban·Timeline 4가지 뷰
- 행 페이지 전체 화면 열기 + 사이드 피크 모달
- 헤더 `+` 버튼 컬럼 추가 / grip 핸들 컬럼 드래그 재정렬
- 박스 다중 선택 (마우스 드래그) — `src/hooks/boxSelect/`
- 다단 레이아웃 (Columns) TipTap 확장
- `src/__tests__/securityRegression.test.ts`: HI-19 T-1~T-5 (duplicate 격리, panelState, loadPages, URL 스킴, databaseBlock 삭제 동작).
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/adr/README.md`.
- `.nvmrc`, `package.json` `engines`, static hosting용 `vercel.json` 보안 헤더.
- Zustand persist `version`/`migrate` for page/settings/contacts stores.
- Global `window` error / `unhandledrejection` logging via `reportNonFatal`.

### Changed

- **HI-14**: `DatabaseBlockView` UI를 `DatabaseBlockBinding`, `DatabaseDeleteConfirmDialog`, `DatabaseBlockInlineHeader`, `DatabaseBlockFullPageHeader`, `DatabaseViewKindToggle` 등으로 분리.
- **HI-13**: 박스 선택 로직을 `src/hooks/boxSelect/` 모듈로 분리(오버레이 DOM, 히트 테스트, 마퀴 세션, PM 멀티블록 오버레이, Esc/삭제).
- **번들(HI-34)**: Vite `manualChunks`, `lowlight` 동적 로드(로드 전 StarterKit 기본 `codeBlock`), 이모지 피커 lazy (`EditorEmojiPickerPanel`, `IconPickerEmoji`).
- `DatabaseBlockView`: `panelState`는 attrs 원문 문자열이 바뀔 때만 zod 파싱 · `dbHomePageId`는 store 셀렉터로 계산.
- `BlockHandles`: 그립 호버용 `mousemove`를 `requestAnimationFrame`으로 코얼레싱.
