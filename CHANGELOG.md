# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.4.14] - 2026-05-17

### Changed

- **LC 스케줄러/MM 성능 기반**: 계획 문서, schedule selector, 행 virtualization, MM 집계 캐시, 낙관적 update/delete 보강.
- **DB 렌더링 최적화**: DB 행 projection selector, table/list/timeline windowing, gallery/kanban 구독 축소.
- **동기화 적용 최적화**: bootstrap fetch 결과를 page/database/comment 단위 batch apply로 반영해 초기 동기화 setState 횟수 축소.
- **공통 UI 성능 정리**: 사이드바 트리 캐시, 히스토리 지연 마운트, 표 overlay 측정 rAF throttle, 주요 modal lazy chunk 분리.

## [5.4.13] - 2026-05-17

### Fixed

- **LC 스케줄러 동기화**: LC 스케줄러 행 페이지가 일반 워크스페이스로 저장될 수 있던 스코프 오류를 보정.
- **LC 스케줄러 생성/삭제 UX**: 일정 생성·삭제를 낙관적 업데이트로 처리하고, 피커뷰와 삭제 확인 흐름을 즉시 반응하도록 개선.
- **LC 스케줄러 삭제 안정성**: 삭제된 일정 카드가 재조회·구독 upsert로 되살아나지 않도록 tombstone 처리.
- **워크스페이스 선택 유지**: 새로고침 후 마지막 방문 워크스페이스를 복원하도록 보정.

## [5.4.12] - 2026-05-17

### Fixed

- **LC 스케줄러 드래그 피드백**: 특이사항 카드 생성 마퀴 색상을 주황색으로 보정하고, 연차/일정과 구분되도록 정리.
- **LC 스케줄러 선택 드롭다운**: 조직/팀 동명이인 숨김 규칙에서 선택 상태와 표시값이 어긋나던 문제를 보정.
- **LC 스케줄러 삭제 UX**: 시스템 confirm 대신 QuickNote 내부 중앙 확인 팝업으로 통일.
- **항목 페이지 기본 속성**: 새 카드 기본 활성화에서 `프로젝트` 속성을 제외하고 기존 기본 프리셋에도 동기화 반영.

## [5.4.11] - 2026-05-15

### Fixed

- **TopBar 경로**: Lucide 페이지 아이콘이 `quicknote-lucide:…` 문자열로 보이던 문제를 `PageIconDisplay`로 수정.
- **DB 항목 페이지**: 속성 패널·헤더 영역 최대 너비를 본문 에디터 컬럼(`max-w-[968px]` / `max-w-[1256px]` 등)과 동일하게 맞춤.
- **DB 항목 페이지**: 제목 옆 `IconPicker`에 아이콘 미설정 시 `FileText` 기본 아이콘이 보이도록 복구.
- **DB 항목 페이지**: 우측 댓글 거터 예약 여부를 에디터와 동일하게(페이지 인라인 댓글 제외) 계산.

## [5.3.0] - 2026-05-12

### Added

- **블록 배경색 프리셋**: 텍스트·제목·인용·토글·목록 블럭에 10가지 파스텔 배경색 적용 기능 추가 (블럭 핸들 메뉴 → 배경색).
- **DB 이름 셀 아이콘**: 표·칸반·갤러리 뷰의 이름 셀에 페이지 아이콘 표시 및 클릭으로 변경 가능.
- **디폴트 페이지 아이콘**: 아이콘 미설정 시 일반 페이지는 FileText, DB 페이지는 Database 아이콘으로 표시.
- **DB 템플릿**: 새 행 생성 시 기본 셀 값을 미리 지정하는 템플릿 기능 추가 (`DatabaseTemplate` 타입, `DatabaseTemplateButton` 컴포넌트).

### Changed

- **IconPicker 팝업**: `createPortal`로 `document.body`에 렌더링 → DB 컨테이너 overflow clip 해소.
- **표 블럭 스크롤**: JS wheel 이벤트 차단 제거, CSS `overscroll-behavior-x: contain`으로 자연스러운 터치패드 스크롤 지원.
- **DB fullPage 스크롤**: `layout` prop 기반으로 `max-h-[60vh]` 제한을 fullPage에서만 제거.
- **DB 전체 페이지 BlockHandles**: fullPage DB 뷰에서 블럭 핸들러 제거.

### Fixed

- **표 헤더 토글 교차 셀**: 헤더행 활성 상태에서 헤더열 비활성화 시 교차 셀 스타일 유지.
- **DB 테이블 체크박스 정렬**: 1열 체크박스 셀 중앙 정렬.
- **DB 테이블 아이콘 즉시 반영**: 이름 셀에서 아이콘 변경 시 실시간 업데이트.
- **템플릿 페이지 rowPageOrder 제외**: `_qn_isTemplate` 마커가 있는 페이지를 행 목록에서 제외.

## [5.0.19] - 2026-05-11

### Added

- **블록 댓글 동기화 보조**: `mergePageBlockComments`, 원격 스냅샷 델타 기반 인앱 알림(`notifyRemoteBlockCommentDelta`), 레거시 `quicknote.blockComments.v1` → 페이지 마이그레이션, 단위 테스트.

### Changed

- **GraphQL 페이지 필드**: `blockComments`를 리스트·구독·`upsertPage` 응답에 항상 포함(빌드 시 env 로 제외하지 않음).
- **댓글 upsert**: `pageStore`에서 `blockComments`를 항상 뮤테이션에 실어 보냄. 댓글 변경 후 서버 반영 디바운스를 약 450ms로 단축.
- **문서**: `CLAUDE.md`, `.env.example`에서 댓글 필드 비활성화 env 안내 제거.

### Fixed

- **원격 페이지 적용**: 원격 `blockComments`가 비어 있어도 로컬 스레드를 id 기준으로 병합해 유실 방지.
- **에디터 장식**: 댓글 추가·수정·삭제·읽음 처리 시 블록 하이라이트가 갱신되도록 레지스트리에서 트랜잭션 디스패치.
- **`blockCommentStore` 집계**: 본문·멘션 변경이 시그니처에 반영되도록 보정.

### Infrastructure

- **Lambda `upsertPage`**: 요청에 `blockComments` 키가 없을 때 DynamoDB 기존 값을 읽어 이어 붙여, 구 클라이언트 Put으로 댓글이 지워지지 않도록 처리.

## [5.0.18] - 2026-05-11

### Added

- **커스텀 페이지 아이콘**: 아이콘 피커에 `루시드 / 이모지 / 커스텀` 탭을 추가하고, 업로드한 아이콘을 재사용 목록에 저장. 커스텀 목록에서는 우클릭으로 프리셋만 삭제 가능.
- **DB 뷰 모드 표시 설정**: 속성 표시 팝업에서 칸반·타임라인·갤러리 모드를 감출 수 있도록 추가. 표 모드는 기본값으로 항상 표시.
- **선택 속성 색상 프리셋**: 선택/다중 선택/상태 옵션 편집에 색상 프리셋을 추가하고, 셀 표시에도 옵션 색상을 반영.
- **날짜 이동 입력**: DB 날짜 선택 달력의 년/월 제목을 더블클릭해 직접 이동할 수 있도록 추가.

### Changed

- **페이지 너비 설정**: 전체 너비 보기 상태를 페이지별로 저장하도록 변경.
- **팀 UI 강조**: 팀 목록 및 팀 편집 팝업의 등록 구성원 항목에 파란색 배경 스타일 적용.
- **슬래시 메뉴 순서**: 데이터베이스 관련 명령을 하단으로 이동해 `새 페이지` 등 기본 명령 접근성을 개선.
- **컬럼 블럭 핸들**: 박스 선택 없이도 컬럼 블럭 핸들이 표시되도록 조정.

### Fixed

- **DB 검색 가시성**: DB 행 내부에서 생성된 하위 페이지가 사이드바 트리에는 숨겨지되, 검색 결과에는 노출되도록 보정.
- **DB 테이블 + 버튼 정렬**: 테이블 우측 마지막 열의 속성 추가 버튼을 셀 중앙에 정렬.

## [5.0.17] - 2026-05-11

### Added

- **외부 링크 북마크 카드**: URL 붙여넣기 메뉴에서 `북마크` 선택 시 제목·설명·사이트명·대표 이미지를 표시하는 Notion 스타일 `bookmarkBlock` 삽입.
- **북마크 메타데이터 API**: Vercel 서버리스 `/api/bookmark` 로 Open Graph/Twitter 메타데이터를 조회하고, 실패 시 도메인 기반 fallback 카드 표시.
- **표 블럭 컨트롤**: 일반 페이지 표에서 행·열 추가 및 드래그 재정렬용 hover 컨트롤 추가.

### Changed

- **슬래시 메뉴 UX**: 3열 레이아웃을 단일 컬럼으로 복원하고, 카테고리 제목 대신 구분선만 표시.
- **외부 URL 붙여넣기 팝업**: 커서 위치 기준으로 표시하고, 뷰포트 밖으로 잘리지 않도록 자동 보정.
- **동영상 임베드 여백**: YouTube·동영상 파일 블럭의 상하 여백을 줄여 문서 흐름을 더 촘촘하게 조정.
- **내부 QuickNote 링크**: 페이지/블럭/탭 이동 링크를 웹 URL 형태로 복사·해석하고, 붙여넣기 시 이동 버튼으로 삽입.

### Fixed

- **박스 드래그 선택 시각화**: 상단 탭/헤더 영역까지 덮도록 레이어를 정리하고, 팝업 메뉴가 선택 오버레이에 가리지 않도록 z-index 보강.
- **박스 드래그 안정화**: 새로고침 후 시각화가 간헐적으로 뜨지 않거나, 긴 탭 블럭 선택 중 원치 않는 자동 스크롤이 발생하던 문제 완화.
- **링크 affordance**: 에디터 본문 링크에 hover 커서를 적용해 클릭 가능한 링크임을 명확히 표시.
- **블럭 핸들 메뉴**: 컬럼·탭·테이블 등 컨테이너성 블럭에서 부적절한 타입 변경 메뉴를 숨김.

## [5.0.16] - 2026-05-11

### Added

- **페이지 커버 S3 동기화**: `Page`/`PageInput`에 `coverImage` 필드(AppSync·Lambda). 로컬에 `quicknote-image://` ref 저장, 본문 이미지와 동일 PreSigned 업로드 파이프라인.
- **커버 전용 압축·크롭**: 배너 가로세로비(4:1) 중앙 크롭, 최대 가로 1280px WebP로 용량 절감. GIF는 원본 유지.
- **AppSync 토큰 갱신**(`apiTokens`): ID 토큰 만료 임박 시 `signinSilent`로 갱신 후 쿼리·구독에 주입(웹/로컬 장시간 세션 동기화 안정화).

### Changed

- **본문 이미지**: 업로드 전 `prepareImageFileForUpload`로 공통 압축(WebP, 최대 1920×3840 박스).
- **에디터 레이아웃**: 커버 이미지는 `max-w-3xl` 컬럼 밖에서 **전체 에디터 패널 너비**로 표시(넓은 창·Tauri에서 전폭 배너).

### Fixed

- **커버 동기화**: GraphQL·스토어에 `coverImage`가 빠져 원격과 불일치하던 문제.

## [5.0.15] - 2026-05-10

### Added

- **databaseViewPrefsStore**: 워크스페이스·데이터베이스별 로컬 패널 상태(필터·정렬·속성 표시 등)를 persist 저장. 문서에 인코딩하던 `panelState`와 분리해 페이지 doc 동기화 부담을 줄임.

### Changed

- **데이터베이스 블록**: 패널 상태 변경은 로컬 prefs 스토어에만 반영하고, 노드 attrs의 `panelState`는 레거시 초기값·마이그레이션 fallback 용도로만 유지.
- **DB 전체 화면 헤더**: 「다른 DB 연결」 버튼 제거(인라인 블록 문맥에서의 연결 UI는 유지).
- **속성 패널(DatabasePropertyPanel)**: 제목(title) 열 표시명 인라인 수정 등 편집 UX 보강.

### Fixed

- **페이지 커버 이미지(PageCoverImage)**: 빈 상태·추가 버튼 표시 등 표시 흐름 정리.

## [5.0.14] - 2026-05-10

### Added

- **데이터 안전성 레이어**: persisted store migration runner에 validation과 `migrationQuarantine` 보존 영역을 추가해, 복구 불가능한 원본을 삭제하지 않고 디스크에 남기도록 개선.
- **page/database 보존형 migration**: 기존 page/database 캐시 shape를 검증하고, 유효한 레코드는 유지하며 손상된 레코드만 quarantine으로 분리하는 migration 테스트 추가.
- **outbox dead-letter 보존**: 영구 실패 mutation이 최대 재시도에 도달하면 제거 전에 dead-letter 저장소로 보존.
- **블록 registry 확장**: 블록별 editor/serialization/toolbar/command policy 선언 슬롯을 추가해 신규 블록 확장과 향후 블록 단위 migration 기반을 마련.

### Fixed

- **워크스페이스 첫 렌더 캐시 오염 방지**: 현재 워크스페이스와 소속이 다른 page/database 캐시가 있으면 앱 본문 렌더 전에 gate를 걸어 stale 화면이 보이지 않도록 보강.
- **pending outbox 전환 경로 안정화**: 워크스페이스 전환 중 미전송 mutation이 있으면 원격 데이터를 기존 stale cache에 섞지 않고, flush/reconcile 이후에만 현재 워크스페이스 데이터를 적용.
- **history/comment/notification workspace scope**: 히스토리·댓글·알림 데이터에 workspace 경계를 보강해 워크스페이스 간 UI/복원 데이터 혼선을 줄임.

### Changed

- persisted store migration, workspace switch, sync engine, block policy 관련 회귀 테스트를 보강하고 릴리스 전 검증 기준선을 `285`개 테스트로 확장.

## [5.0.13] - 2026-05-09

### Added

- **블록 정책·레지스트리**: DnD/에디터/UI 정책 및 슬래시 제목 매핑(`src/lib/blocks/`).
- **persistedStore 마이그레이션**: 공통 메타·첨부 패턴 및 스토어별 마이그레이션 테스트 보강.
- **동기화**: outbox 플러시 순서·메타 타입 보강, 온라인 복귀 후 캐시 재조화(`reconcileWorkspaceCacheAfterFlush`), **동기화 배너**(`WorkspaceSyncBanner`)로 블라인드 상태 안내.

### Fixed

- **웹 에디터** 본문 끝에서 스크롤·입력 여백이 부족하던 문제(`min-h-0`, 하단 DOM 스페이서 + 픽셀 동기화 + `scroll-padding-bottom`).
- **탭 블록** 생성 직후 캐럿이 패널 안에 남던 문제 → 삽입 후 레이아웃 다음에 캐럿을 탭 블록 **바깥**(다음 블록 또는 문서 끝 빈 단락)으로 이동.

### Changed

- 슬래시 메뉴에서 **다열 분리 항목 제거** → **컬럼** 단일 항목만 노출, 삽입 시 **2열 레이아웃** 고정.
- 동기화 엔진·워크스페이스 전환·스토어 적용(`storeApply`), 댓글·알림·설정 등 부수 개선 및 테스트 추가.

## [5.0.12] - 2026-05-09

### Added

- **휴지통**: 사이드바에서 삭제 페이지 조회(삭제 시각 최신순)·복원, 30일 보관 후 영구 삭제(일일 DynamoDB purge Lambda), AppSync `listTrashedPages`/`restorePage` 및 구독에 복원 반영.
- **휴지통 UI**: 최초 50건 로드, `더보기`로 50건씩 추가 로드(서버 `nextToken` 커서).
- **워크스페이스 랜딩**: 워크스페이스별 마지막 방문 페이지 기억·복원(settings persist v6), 없으면 사이드바 루트 첫 페이지로 시작.
- **워크스페이스 부트스트랩**: `applyWorkspaceSwitch` 가 초기 세션(`prev=null`)에서는 persist 캐시를 비우지 않도록 조정.

### Fixed

- **새로고침**: 탭은 맞는데 본문이 비던 현상(초기 클리어와 persist 충돌) 완화.
- **실행취소**: 블록 삭제·박스 삭제 직후 `Ctrl+Z` 가 PM 히스토리로 가지 않던 문제(포커스 복귀 + 창 캡처 단축키 전달).

### Changed

- 페이지 버전 타임라인·목록 등에 **마지막 편집자**(`lastEditedBy*`) 표시 보강.

## [5.0.11] - 2026-05-09

### Added

- **탭 블록**: 다중 `tabPanel`·탭 헤더·배치(상·하·좌·우), 슬래시 메뉴 삽입, 탭 패널 영역 드롭 타깃 보강.

### Fixed

- **탭 전환 시 본문이 바뀌지 않던 문제**: TipTap React 노드뷰가 `.qn-tab-panels` 안에 PM용 `data-node-view-content-react` 래퍼를 두어 기존 CSS 직계 선택자가 패널에 적용되지 않던 점을 수정하고, `[data-active-index]` DOM 동기화·트랜잭션 직후 패널 표시 재적용으로 안정화.

### Changed

- 탭/패널 DOM 디버그용 콘솔 로그 제거.

## [5.0.10] - 2026-05-08

### Fixed

- **즐겨찾기(clientPrefs) 동기화**: AppSync `AWSJSON` 이중 문자열 래핑 디코드, 동일 타임스탬프 시 목록 불일치 시 서버 스냅샷 수렴, `updateMyClientPrefs` 직접 GraphQL 전송 및 응답 `errors` 검사.
- **settings persist v4**: 즐겨찾기 타임스탬프 복구로 LWW 역전 방지.

### Changed

- **프로덕션 콘솔**: `[QN clientPrefs]` 디버그 로그 제거(실패 시 `[sync]` 오류만 유지).

## [5.0.9] - 2026-05-08

### Fixed

- **자동 업데이트 직후 에디터가 빈 문서로 스토어·버전 히스토리를 덮어쓸 수 있던 문제**: 초기 마운트 시 TipTap이 빈 `doc`에서 시작하는 동안 자동 저장이 먼저 실행되지 않도록 하이드레이션 가드를 두고, 동일 문서의 중복 `updateDoc`은 무시하며 정규화(stale blob 제거 등)만 할 때는 로컬 히스토리를 남기지 않도록 분리.

## [5.0.8] - 2026-05-08

### Changed

- **`package.json`과 Tauri `tauri.conf.json` 버전을 `5.0.8`로 함께 올림**: 데스크톱 CI의 버전 일치 검증과 릴리스 메타 정보를 명확히 맞추기 위한 패치 릴리스.

## [5.0.7] - 2026-05-08

### Fixed

- **컬럼/박스 드래그 중 에디터 뷰 접근 예외**: `ColumnReorderHandles` 의 마우스 이동/갱신 경로에서 `editor.view` 언마운트 타이밍 접근으로 `[tiptap error]: The editor view is not available` 가 반복 발생하던 문제를 방어. `view/dom` 접근을 예외 안전 가드로 통일해 페이지 전환·리로드 직후에도 에러 스팸 없이 동작.
- **버전 히스토리 중첩 버튼 hydration 오류 재발**: 히스토리 리스트 항목의 인터랙션 래퍼를 버튼 중첩이 생기지 않는 구조로 정리해 `<button> cannot be a descendant of <button>` 오류를 해소.
- **컬럼 드래그 시 잘못된 텍스트 삽입/되돌리기 불안정**: 컬럼 핸들 drag payload 처리와 드롭 경로를 보강해 텍스트만 떨어지는 오동작을 줄이고 의도한 컬럼 재정렬만 반영되도록 안정화.
- **Tauri 번들 버전과 package.json 불일치로 CI 실패**: `src-tauri/tauri.conf.json` 의 `version` 을 `package.json` 과 동일한 `5.0.7` 로 맞춤.

### Changed

- 사이드바 즐겨찾기 노출 위치를 오른쪽 패널 중심으로 정리하고, 패널 헤더에 즐겨찾기 개수 표시를 추가.
- 릴리즈 전 `QN-DEBUG` 콘솔 로그를 정리해 프로덕션 콘솔 노이즈를 제거.

## [5.0.6] - 2026-05-07

### Fixed

- **AppSync GraphQL Subscription 미연결로 실시간 동기화 미작동**: `defaultAuthMode: "none"` + 수동 헤더 주입 방식이 query/mutation 에는 작동하지만 subscription 의 connection_init 핸드셰이크에는 토큰이 안 붙어 WebSocket 연결 자체가 시도되지 않던 문제. `subscribers` 가 `readStoredTokens()` 로 idToken 을 읽어 `authToken` 옵션으로 직접 주입하도록 수정. 이제 다른 클라이언트의 페이지/DB 변경이 워크스페이스 전환 없이 즉시 반영.
- **Tauri SQLite outbox UNIQUE 제약 race**: `upsertByDedupe` 가 `DELETE → INSERT` 두 statement 였던 탓에 같은 dedupeKey 로 거의 동시에 enqueue 가 일어나면 `UNIQUE constraint failed: outbox_entries.dedupeKey` 로 실패. SQLite UPSERT(`ON CONFLICT(dedupeKey) DO UPDATE`) 한 statement 로 atomic 처리.

### Added

- **사이드바 페이지 Delete/Backspace 단축키**: 활성 페이지를 Delete (또는 맥의 Backspace) 키로 삭제. 우클릭 메뉴와 동일하게 확인 다이얼로그 경유.

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
