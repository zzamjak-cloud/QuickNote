# 페이지 본문 지연 로드

초기 워크스페이스 로드 시 페이지 메타(제목·아이콘 등)만 수신하고, 실제 본문(doc·dbCells)은 페이지를 열 때 로드하는 메커니즘.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/pageContentLoad.ts` | `ensurePageContentLoaded()` 구현 |
| `src/store/pageContentLoadStore.ts` | metaOnly 상태 추적. persist 키 `quicknote.page-content-load.v1` |

## Store 구조

```typescript
// pageContentLoadStore
metaOnlyByPageId: Record<string, true>   // 메타만 있는 페이지 집합 (persist)
loadingByPageId:  Record<string, boolean> // 로드 진행 중 (비persist)

markMetaOnly(pageIds)  // 초기 스냅샷 적용 후 호출
markLoaded(pageIds)    // 본문 로드 완료 후 제거
```

## 동작 흐름

```
ensurePageContentLoaded(pageId)
  ├─ metaOnlyByPageId[pageId] 없고 page.contentLoaded !== false → skip (이미 있음)
  ├─ inFlightByPageId 중복 요청 방지
  ├─ workspaceId 결정 (args → page.workspaceId)
  ├─ fetchPageById(workspaceId, pageId)
  ├─ applyRemotePageToStore(page)
  └─ refreshWorkspaceSnapshot(workspaceId)
```

## 주의사항

- **중복 요청 방지**: `inFlightByPageId` Map으로 동일 pageId 중복 요청을 단일 Promise로 공유.
- **workspaceId 누락**: workspaceId 없으면 경고 로그 후 `false` 반환 (silent fail).
- **메타 모드 초기화**: `fetchApplyWorkspaceRemoteMetaSnapshot` 적용 직후 `markMetaOnly(모든pageId)` 호출 필요. 해당 호출이 빠지면 본문 로드가 트리거되지 않는다.
- **stale metaOnly 제거**: 이미 `contentLoaded=true` 인 full-cache 페이지에 메타가 다시 내려오면 `markLoaded` 로 stale metaOnly 플래그를 제거한다. 그렇지 않으면 캐시 본문이 있어도 클릭 때마다 서버 본문을 다시 받는다.

## 관련 위키
- [architecture.md](architecture.md) — 분할 로드 전략 전체 그림

## 서버 "페이지 없음" 자기치유 (2026-07-03)

**배경**: 휴지통 영구삭제(hard delete)는 델타 싱크에 tombstone 이 없다. soft delete tombstone 을
받기 전에 영구삭제가 일어나면 다른 PC 캐시에 페이지가 유령으로 남고, 진입 시 collab connect 가
거절되어 `WebSocket connection failed` 만 반복된다(실사례: 2026-07-02 CAT 복제 후 삭제).

**동작**: GET_PAGE 계열은 오류 시 throw, 서버가 확정적으로 없다고 하면 `null` 을 반환한다 —
이 구분이 안전장치의 핵심. `null` 일 때만 `pruneServerMissingPageFromCache`(storeApply/pageApply.ts)가
합성 tombstone 으로 삭제 경로(스토어·activePageId·rowOrder·row-index·스냅샷 갱신)를 재사용해 정리한다.

**호출 지점**: ① Editor 협업 시드 fetch(`fetchPageById` null — 이전엔 1.5s 무한 재시도했음)
② `ensurePageContentLoaded` fetch null.

**오인 삭제 방지 가드**: 로컬 없음 / 최근 10분 내 생성·수정(신생) / outbox 업로드 대기
(`getPendingUpsertEntityIds`) / workspaceId 미해석 → 전부 보류(prune 안 함). 보류 시 Editor 는
기존 재시도 유지. 회귀 테스트: `src/__tests__/sync/pruneServerMissingPage.test.ts`.
