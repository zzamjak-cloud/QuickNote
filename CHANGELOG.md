# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- 페이지 아이콘 트리거 UI를 텍스트(`아이콘 추가`)에서 `+` 심볼 아이콘으로 변경.
- 데이터베이스 툴바를 단일 라인으로 정리: 좌측 뷰 모드 토글, 우측 검색/정렬/필터/속성 액션.
- 인라인 데이터베이스 헤더의 중복 드래그 핸들 표시 제거.
- 테이블 헤더의 별도 속성 설정 컬럼을 제거하고 툴바의 속성 버튼으로 통합.
- 테이블 선택 체크박스 열 폭/정렬을 재조정해 컬럼 라인과 겹침을 완화.

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
