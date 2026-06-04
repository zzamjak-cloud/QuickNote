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

## 관련 위키
- [architecture.md](architecture.md) — 분할 로드 전략 전체 그림
