# 데이터 손실 방지

## 작업 시작 전 체크리스트
- [ ] `infra/` 변경 있는가? → CDK 배포 먼저
- [ ] `Page` 또는 `Database` 타입 변경되는가? → persist version 계획 수립
- [ ] AppSync 스키마(`infra/graphql/`) 변경되는가? → 프론트 타입 동기화 확인

## 머지 전 체크리스트
- [ ] CDK 배포 완료 확인
- [ ] 개발 환경에서 페이지 생성 → 웹에서 즉시 보이는지 확인
- [ ] persist version 변경 시 마이그레이션 테스트 완료

## 데이터가 사라진 경우 진단

**Step 1: outbox 확인**
```
DevTools → Application → IndexedDB → outbox 테이블
```
entries 있으면 → 뮤테이션 서버 미전달 (CDK 미배포 or 네트워크 문제)

**Step 2: AppSync 로그**
```
AWS 콘솔 → AppSync → Logging → 최근 요청 에러
```

**Step 3: localStorage 확인**
```js
JSON.parse(localStorage.getItem('quicknote.pages.v1') ?? '{}')
```

**Step 4: localStorage 초기화 (최후 수단)**
```js
["quicknote.pages.v1","quicknote.databases.v1","quicknote.settings.v1"]
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

## 회귀 방지 가드 (Phase 0, `a693b82e`)

### upsertPage payload 350KB 가드 (대칭)
`enqueueUpsertPage`(pageStore)와 `enqueueUpsertPageRaw`(databaseStore)가 동일한 상한을 공유한다.
상수·측정 함수는 **단일 출처** `src/store/pageStore/helpers.ts` 의
`MAX_UPSERT_PAGE_PAYLOAD_BYTES` / `payloadByteLength` 이고,
`src/store/databaseStore/helpers.ts` 가 이를 import 한다(비대칭 해소).
초과 시 enqueue skip + `console.warn("[sync] upsertPage skipped: payload too large", ...)`.
- 회귀 주의: 한쪽에만 가드를 넣으면(과거 상태) 큰 payload 가 그쪽 경로로 새어 서버 거부/누락된다.

### localStorage 키 중앙화
persist 키 중복 정의를 제거했다. 새 키는 중앙 정의를 import 하고 문자열 리터럴을 곳곳에 박지 않는다(중복 금지).

### dev/live 캐시 격리
dev 데스크톱 빌드는 별도 Tauri identifier 를 써 라이브 앱데이터를 오염시키지 않는다.
세부는 [observability.md](observability.md).

## 제거된 데드코드 12건 (behavior-preserving)

미사용 컴포넌트/훅/타입 12개 파일 삭제 — 동작 변화 없음. wiki 에서 이들을 참조하지 말 것.

`UserMenu.tsx`, `DatabaseBlockLinkExistingPanel.tsx`, `DatabaseViewKindToggle.tsx`,
`EditorEmojiPickerPanel.tsx`, `ScheduleEditPopup.tsx`, `WeekGrid.tsx`,
`admin/OrganizationsPanel.tsx`, `admin/TeamsPanel.tsx`, `TeamDetailPanel.tsx`,
`useMemberSuggestionDropdown.ts`, `types/block.ts`, `HandleLayer.tsx`(미사용 코드 정리).
(slashMenu 의 `SlashItem`/`filterSlashItems` 는 `@deprecated` 정리.)
