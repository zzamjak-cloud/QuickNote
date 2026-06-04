# QuickNote Wiki

AI 탐색용 위키 인덱스. 작업 전 해당 파일을 먼저 읽으면 소스 탐색 없이 구조 파악 가능.

---

## 빠른 진입 (증상 → 파일)

| 증상 / 작업 | 위키 파일 |
|------------|---------|
| 팝업·드롭다운 화면 밖으로 나감 | `ui/popup-clipping.md` |
| 팝오버 위치 커스텀 | `ui/useAnchoredPopover.md` |
| 박스 드래그 선택 안 됨 | `ui/useBoxSelectMarquee.md` |
| 피커뷰 툴바 위치 버그 | `ui/pickerview-toolbar.md` |
| 이미지 리사이즈 핸들 버그 | `editor/image-resize.md` → `editor/ImageResizeOverlay.md` |
| TipTap 확장 추가 | `editor/lib-tiptapExtensions.md` → `editor/useEditorExtensions.md` |
| 에디터 구조 파악 | `editor/Editor.md` |
| 블록 핸들(그립/메뉴) 수정 | `editor/BlockHandles.md` |
| DB 뷰 전환·레이아웃 | `database/DatabaseBlockView.md` |
| DB 테이블 뷰 | `database/DatabaseTableView.md` |
| DB 타임라인 뷰 | `database/DatabaseTimelineView.md` |
| DB 셀 타입 추가·수정 | `database/cells.md` |
| DB 필터·정렬 | `database/filters-sort.md` |
| DB 그룹화(표시설정) | `database/grouping.md` |
| DB 데이터 읽기·쓰기 | `database/databaseStore.md` |
| DB 뷰 설정(필터 상태 등) | `database/databaseViewPrefsStore.md` |
| DB 유틸 함수 | `database/lib-database.md` |
| 자산 관리 탭·캐싱 | `settings/assets.md` |
| 동기화 버그·흐름 | `sync/architecture.md` → `sync/engine.md` |
| outbox 쌓임·뮤테이션 미전송 | `sync/engine.md` → `sync/outbox.md` |
| LWW 충돌 해결 수정 | `sync/storeApply.md` |
| AppSync 구독 재연결·수명주기(스케줄러 지연구독) | `sync/subscribers.md` |
| 앱 초기 로드 흐름 | `sync/Bootstrap.md` |
| 워크스페이스 재페치 증분 동기화(워터마크) | `sync/incremental-sync.md` |
| 멘션·검색 캐시 전용(서버 호출 금지) | `store/memberStore.md` |
| 휴지통 영구삭제(TTL `purgeAt`) | `history/overview.md` |
| 페이지 CRUD | `store/pageStore.md` |
| 댓글 상태 | `store/blockCommentStore.md` |
| 인증 상태 | `store/authStore.md` |
| 워크스페이스 전환 | `store/workspaceStore.md` |
| 멤버·역할 | `store/memberStore.md` |
| 설정 persist | `store/settingsStore.md` |
| Zustand persist 버전 bump | `store/schema-versioning.md` |
| 배포 절차 | `infra/deploy.md` |
| 서버 비용 최적화 배포·백필(TTL·GSI·증분) | `infra/cost-optimization-deploy.md` |
| 버전 bump (package.json + tauri) | `infra/version-sync.md` |
| 데이터 손실 방지·진단 | `infra/data-safety.md` |
| 기술 스택 파악 | `infra/tech-stack.md` |

---

## 카테고리별 파일 목록

### editor/
| 파일 | 내용 |
|------|------|
| `overview.md` | 에디터 구조 개요 |
| `Editor.md` | Editor.tsx — props, 상태, 주요 훅 |
| `BlockHandles.md` | BlockHandles.tsx — 블록 그립·메뉴 UI |
| `useEditorExtensions.md` | 확장 조합 훅 |
| `lib-tiptapExtensions.md` | 커스텀 TipTap 확장 전체 목록 |
| `lib-editor.md` | lib/editor/ 유틸 함수 |
| `imageBlock.md` | imageBlock.tsx — 확장 속성·렌더 |
| `ImageResizeOverlay.md` | 리사이즈 핸들 오버레이 |
| `image-resize.md` | 이미지 리사이즈 회귀 방지 규약 |
| `images.md` | lib/images/ — S3 업로드·URL 캐싱 |
| `slash-menu.md` | 슬래시 메뉴 커맨드 추가 |
| `extensions.md` | 확장 등록 패턴 |

### database/
| 파일 | 내용 |
|------|------|
| `overview.md` | DB 구조 개요 |
| `DatabaseBlockView.md` | 루트 컴포넌트 — 뷰 스위치 |
| `DatabaseTableView.md` | 테이블 뷰 |
| `DatabaseTimelineView.md` | 타임라인(Gantt) 뷰 |
| `databaseStore.md` | DB 데이터 스토어 |
| `databaseViewPrefsStore.md` | 뷰 설정 스토어 |
| `lib-database.md` | lib/database/ 유틸 전체 |
| `cells.md` | 셀 타입별 컴포넌트 |
| `views.md` | 뷰 종류 개요 |
| `filters-sort.md` | 필터·정렬 로직 |
| `grouping.md` | 그룹화 엔진·뷰 통합·동기화 |

### sync/
| 파일 | 내용 |
|------|------|
| `architecture.md` | 동기화 전체 흐름도 |
| `engine.md` | SyncEngine — outbox, 재시도 |
| `storeApply.md` | LWW 충돌 해결 |
| `subscribers.md` | AppSync WebSocket 구독 |
| `outbox.md` | IndexedDB outbox 디버깅 |
| `conflict-resolution.md` | LWW 전략 개요 |
| `Bootstrap.md` | 앱 초기 로드 흐름 |
| `incremental-sync.md` | 증분 동기화(델타+워터마크)·회귀 규칙 |

### store/
| 파일 | 내용 |
|------|------|
| `overview.md` | 스토어 전체 목록 |
| `pageStore.md` | 페이지 CRUD·persist |
| `databaseStore.md` | → `database/databaseStore.md` |
| `historyStore.md` | 버전 히스토리 |
| `authStore.md` | 인증 상태 |
| `workspaceStore.md` | 워크스페이스 |
| `memberStore.md` | 멤버·역할 |
| `blockCommentStore.md` | 댓글 스레드 |
| `settingsStore.md` | 앱 설정 |
| `schedulerStore.md` | 스케줄 캐시 |
| `schema-versioning.md` | persist 버전 관리 패턴 |

### ui/
| 파일 | 내용 |
|------|------|
| `popup-clipping.md` | 팝업 화면 클리핑 금지 규약 |
| `useAnchoredPopover.md` | 팝오버 훅 API |
| `anchored-popover.md` | 팝오버 사용 패턴 |
| `useBoxSelectMarquee.md` | 박스 선택 마퀴 훅 |
| `box-select.md` | 박스 선택 회귀 방지 |
| `boxSelect-hooks.md` | boxSelect/ 나머지 훅 |
| `pickerview-toolbar.md` | 피커뷰 툴바 회귀 방지 |

### infra/
| 파일 | 내용 |
|------|------|
| `tech-stack.md` | 기술 스택 |
| `deploy.md` | 배포 체크리스트 |
| `version-sync.md` | 버전 동기화 규칙 |
| `data-safety.md` | 데이터 손실 방지 |
| `cost-optimization-deploy.md` | 서버 비용 최적화 배포·마이그레이션 런북(TTL·GSI·BatchGet·증분) |

### blocks/
| 파일 | 내용 |
|------|------|
| `overview.md` | 블록 시스템 전체 구조, 새 블록 추가 절차 |
| `registry.md` | BlockDefinition 타입, 등록된 블록 전체 목록 |
| `policies.md` | editorPolicy / dndPolicy / uiPolicy 함수 상세 |
| `block-types.md` | TipTap 확장별 name·attrs·렌더 방식 |
| `block-commands.md` | moveBlock·delete·insert·drag 유틸 |
| `block-handles.md` | 블록 그립·핸들 UI 컴포넌트 |

### settings/
| 파일 | 내용 |
|------|------|
| `assets.md` | 자산 관리 탭 — 세션 캐시(새로고침 전용 갱신)·클라이언트 필터·삭제 |

### 기타
| 경로 | 내용 |
|------|------|
| `auth/overview.md` | 인증·권한 흐름 |
| `comments/overview.md` | 블록 댓글 |
| `history/overview.md` | 버전 히스토리 UI |
| `scheduler/overview.md` | 스케줄러·캘린더 |
| `search/overview.md` | 검색 |
| `workspace/overview.md` | 워크스페이스 구조 |
| `pages/overview.md` | 페이지 관리 |

---

## 주요 파일 좌표 (코드 직접 참조)

| 역할 | 경로 |
|------|------|
| 동기화 엔진 | `src/lib/sync/engine.ts` |
| LWW 충돌 해결 | `src/lib/sync/storeApply.ts` |
| AppSync 구독 | `src/lib/sync/subscribers.ts` |
| 앱 부트스트랩 | `src/Bootstrap.tsx` |
| 페이지 스토어 | `src/store/pageStore.ts` |
| DB 스토어 | `src/store/databaseStore.ts` |
| 에디터 진입점 | `src/components/editor/Editor.tsx` |
| 블록 핸들 | `src/components/editor/BlockHandles.tsx` |
| 박스 선택 마퀴 | `src/hooks/boxSelect/useBoxSelectMarquee.ts` |
| 팝오버 훅 | `src/hooks/useAnchoredPopover.ts` |
| CDK 인프라 | `infra/` |
