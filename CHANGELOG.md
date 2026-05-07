# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.5] - 2026-05-07

### Fixed

- **데스크톱 stale outbox 호환**: v5.0.4 이전에 객체 형식으로 큐잉된 페이지/DB mutation 이 `Variable 'doc' has an invalid value` 로 영구 거부되어 데이터 손실 위험이 있던 문제. 송신 어댑터(`bridge`)가 `doc`/`dbCells`/`columns` 가 객체이면 송신 직전에 `JSON.stringify` 로 자동 정규화해 옛 형식 stale entry 도 정상 처리.
- **워크스페이스 전환 시 캐시 클리어 보류 안내**: outbox 미전송 mutation 이 남아 클리어가 보류된 경우 콘솔 헬퍼(`await __QN_clearOutbox()`) 로 즉시 비울 수 있도록 가이드 메시지 추가.

### Added

- 디버그용 글로벌 콘솔 헬퍼: `window.__QN_outboxSnapshot()`, `window.__QN_clearOutbox()` (웹 IndexedDB / 데스크톱 SQLite 모두 동일하게 동작).

## [5.0.4] - 2026-05-07

### Fixed

- **AppSync AWSJSON 직렬화 누락으로 v5 이후 모든 페이지/DB 동기화 단절**: `doc`/`dbCells`/`columns` 를 객체 그대로 보내 AppSync 가 `Variable 'doc' has an invalid value` 검증 오류로 모든 `upsertPage`/`upsertDatabase` mutation 을 거부하던 문제. 단 한 페이지도 서버에 도달하지 못해 다른 클라이언트 동기화·워크스페이스 fetch 가 0 건이던 근본 원인. 송신 시 `JSON.stringify`, 수신 시 `parseAwsJson` 안전 파싱.
- **outbox stuck-head**: head entry 가 영구 실패 상태이면 후속 enqueue 가 영원히 처리되지 못하던 문제. 50회 시도 후 영구 실패로 간주하고 dead-letter 처리.
- **워크스페이스 전환 시 이전 워크스페이스 페이지 잔류**: `Page` 레코드에 `workspaceId` 필드가 없어 사이드바에 두 워크스페이스 페이지가 혼재되던 문제. 전환 시 outbox 미전송 mutation 이 0 개일 때만 캐시를 클리어해 데이터 손실 없이 사이드바 갱신.
- **인증/부트스트랩 미완료 시점 enqueue 가드**: `currentWorkspaceId` 가 빈 상태에서 발생한 페이지 변경이 stale entry 로 outbox 에 영구 적재되던 문제. workspaceId 미설정 시 enqueue 자체를 차단.

## [5.0.3] - 2026-05-07

### Fixed

- **새 페이지 새로고침 시 일시/영구 사라짐**: `legacyCleanup.purgeLegacyLocalStorage()` 가 부팅마다 `quicknote.pages.v1` 을 삭제했는데, v5 부터 동일 키를 `pageStore` persist 키로 재사용하면서 충돌. 페이지를 만들고 새로고침하면 persist 가 비워진 채 rehydrate 되어 페이지가 즉시 사라져 보였음. legacy 리스트에서 `quicknote.pages.v1` 제거.
- **페이지·DB mutation 이 DynamoDB 에 도달하지 않던 동기화 단절**: `Page`/`Database` 타입엔 `createdByMemberId: ID!` 가 정의되어 있지만 `PageInput`/`DatabaseInput` 에는 누락되어 있어, 클라이언트가 보낸 mutation 을 AppSync 가 `Field 'createdByMemberId' is not defined for type 'PageInput'` 검증 오류로 거부하던 문제. 모든 페이지/DB 변경이 outbox 백오프 재시도 루프에 갇힌 채 zustand persist 에만 반영되어 클라이언트 간 동기화가 전혀 일어나지 않던 원인. `PageInput`/`DatabaseInput` 에 `createdByMemberId: ID` 추가(누락 시 Lambda 가 caller.memberId 로 폴백). CDK 재배포 필요.

## [5.0.2] - 2026-05-07

### Fixed

- **데스크톱 앱 동기화 무동작**: GitHub Actions 릴리스 워크플로우(`build.yml`)에 `VITE_APPSYNC_ENDPOINT`/`VITE_S3_REGION`/`VITE_S3_BUCKET_NAME` 시크릿이 누락되어, 데스크톱 번들에서 `configureAppSync()` 가 throw 하고 부트스트랩이 조용히 실패하던 문제. UI 가 사용자 역할을 `member` fallback 으로, 워크스페이스를 `워크스페이스 없음` 으로 표시하던 원인. 워크플로우의 `Verify Vite secrets` / `build and release` 스텝에 누락 시크릿을 추가하고, 사전 검증으로 미주입 시 빌드를 즉시 실패시킴.

## [5.0.1] - 2026-05-07

### Added

- 에디터에 버튼 블록/페이지 링크 확장을 추가하고 슬래시 메뉴 항목을 확장
- 페이지/멤버 멘션 UX를 개선해 검색 및 삽입 동작의 일관성을 강화

### Changed

- 워크스페이스/인증/동기화 로직을 정리해 부트스트랩 및 구독 흐름의 안정성을 개선
- 데이터베이스 타임라인/블록 뷰 상호작용을 개선하고 상단바/설정 상태 동기화 동작을 보강

### Infra

- v5 리졸버 핸들러의 인증/워크스페이스 처리 로직을 보강해 예외 상황 대응을 개선
- Vercel CLI로 프로덕션 배포 시 로컬 `src-tauri/target`(Rust 빌드 산출물) 등이 아카이브에 포함되면 업로드가 수 GB로 불어나 실패할 수 있어, 루트 `.vercelignore`로 `node_modules`·`dist`·`src-tauri/target` 등을 제외하도록 정리

## [5.0.0] - 2026-05-07

### Added

- v5 워크스페이스 기반 협업 모델 도입: `Member`, `Team`, `Workspace`, `WorkspaceAccess` 도메인 및 AppSync GraphQL 스키마 확장
- AppSync 단일 `v5-resolvers` Lambda 라우터 + 도메인별 핸들러(`member/team/workspace/pageDatabase/mention`) 및 테스트 추가
- 워크스페이스/구성원/팀 관리 UI(생성/편집/삭제/권한 변경/팀 배정), 멤버 멘션(`@`) 기능 추가
- 워크스페이스 삭제 시 확인 문구 직접 입력 안전장치 다이얼로그 추가
- 레거시 `ownerId` 구조를 v5 구조로 옮기는 `v5-migration` Lambda 추가

### Changed

- 권한 체계를 `owner/manager/member` + 워크스페이스 접근 규칙 기반으로 정리 (manager는 owner 제외 관리 가능)
- 설정 모달 UX 전면 개선: 레이아웃 확장, 팀/워크스페이스 카드형 3열 목록, 아이콘 액션 중심 인터랙션
- 워크스페이스 접근 권한 편집 문구를 자연어 중심으로 개선 (기본 규칙/예외 규칙 요약 제공)
- 부트스트랩 시 인증 후 `me/workspaces/members/teams`를 함께 복원하여 새로고침 후 관리자 데이터 유실 문제 개선
- GraphQL enum 직렬화/역직렬화 정규화(백엔드 대문자 enum, 프론트 소문자 상태) 일관화
- CDK 스택에서 기존 AppSync 리졸버 LogicalId 고정 및 v5 테이블 명 context 주입으로 배포 충돌 완화

### Fixed

- `createMember` 시 `cognitoSub: null` 저장으로 `byCognitoSub` GSI validation 오류가 발생하던 문제 수정
- Pages/Databases 조회 및 워크스페이스 삭제 cascade에서 잘못된 GSI 이름 참조 수정
- 설정 팝업/확인 팝업의 긴 텍스트 overflow 및 줄바꿈 이슈 수정
- 구성원 검색에 팀 정보 포함 및 대소문자 무시 검색 지원

### Removed

- Contacts 도메인 및 관련 UI/스토어 제거 (v5 모델로 통합)

## [4.0.0] - 2026-05-06

### Added

- AWS AppSync 기반 단일 사용자 멀티 디바이스 동기화 (페이지/DB/연락처, LWW)
- 오프라인 outbox 큐 (웹: IndexedDB / Tauri: SQLite) + 자동 재시도(지수 백오프, 최대 60초)
- 실시간 구독 (`onPageChanged` / `onDatabaseChanged` / `onContactChanged`)
- S3 PreSignedURL 기반 이미지 업로드 (≤ 20MB, image/png|jpeg|webp|gif). 에디터 doc 안에는 `quicknote-image://{id}` 가상 스킴으로 영구 ID 만 보유
- 야간 image-gc Lambda (30일 미참조 이미지 정리)
- 새 CDK 스택 `QuicknoteSyncStack`: AppSync API + 4 DDB 테이블(Page/Database/Contact/ImageAsset) + S3 버킷 + Lambda 2종 + EventBridge cron
- 부팅 시 v1~v3 잔여 데이터 자동 폐기

### Changed

- 동기화 대상 스토어(pages/databases/contacts)는 `localStorage`/SQLite 영속화 제거 (클라우드 SoT)
- 페이지 doc 변경은 2초 디바운스 후 푸시, 메타·DB·연락처는 즉시
- 에디터 이미지: IDB 영속화 → S3 업로드 + `quicknote-image://{id}` 가상 스킴 + React NodeView 비동기 src 변환
- 이미지 노드 attr 단순화 — outline/shadow/crop 제거 (성능·복잡도 절감, crop 모달 폐기)

### Removed

- `editorImageStorage.ts` (IDB 이미지 저장)
- `ImageEditModal.tsx` (이미지 크롭 모달)
- `quicknote.pages.v1` 등 v1~v3 localStorage 키 (부팅 시 자동 폐기)

### Infra

- 클라이언트: `aws-amplify` v6 추가, `dexie` v4 추가
- 인프라: `@aws-appsync/utils` 추가, `build:resolvers` esbuild 스크립트 추가

## [3.0.4] - 2026-05-06

### Changed

- GitHub Actions 릴리스용 Repository Secrets(Cognito `VITE_*`, 데스크톱·웹)가 모두 등록된 상태에서 다시 빌드하는 릴리스.

## [3.0.3] - 2026-05-06

### Fixed

- **프로덕션(태그 릴리스) 데스크톱 앱에서 Google 로그인 버튼 무응답**: GitHub Actions `Publish Release`에 `VITE_*` Cognito 환경 변수가 없어 빌드된 번들에 설정이 비어 `signIn` 이 즉시 실패하던 문제. 워크플로우에 시크릿 주입 및 누락 시 사전 실패 검증 추가.
- `signIn` 실패 시 예외를 잡아 로그인 화면에 `callbackError` 메시지로 표시.

### Changed

- `CONTRIBUTING.md` / `README.md`: 데스크톱 릴리스용 필수 Repository Secrets 목록 명시.

## [3.0.2] - 2026-05-06

### Fixed

- `restoreSession` 동시 다발 호출(React Strict Mode 등) 시 한 번만 실행되도록 in-flight 가드.
- 로딩 화면에 **앱 버전(`v*` )** 표시로 실제 실행 중인 빌드 확인 가능.
- 약 **45초** 후에도 `loading`이면 로그인 화면으로 전환하는 `bailIfStuckLoading` 안전망.

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
