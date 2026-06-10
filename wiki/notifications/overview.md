# 인앱 알림 (In-App Notifications)

워크스페이스 멤버별 멘션·답글 알림. 사이드바 헤더 벨 아이콘 + 드롭다운 패널로 표시한다.

## 좌표

| 역할 | 경로 |
|------|------|
| 알림 벨 + 드롭다운 UI | `src/components/notifications/NotificationBell.tsx` |
| 알림 스토어(persist) | `src/store/notificationStore.ts` |
| 서버 API(조회/읽음/삭제) | `src/lib/sync/notificationApi.ts` |
| GraphQL 쿼리 | `src/lib/sync/queries/notification.ts` |
| 부트스트랩 시 전량 동기화 | `src/Bootstrap.tsx` (`fetchMyNotificationsApi` → `setNotifications`) |
| 알림 생성 트리거 | `src/store/blockCommentStore.ts`, `src/store/pageStore.ts` (`addNotification`) |

벨은 `SidebarHeader` / `TopBar` / `SidebarCollapsedRail` 여러 위치에 렌더될 수 있어, **직접 연 인스턴스만 포털을 렌더**한다(`isThisAnchor` 가드). 패널은 `createPortal` + `computeDropdownBelowAnchor` 뷰포트 클램프.

## 데이터 모델

`InAppNotification` — `recipientMemberId`, `kind`(`mention`|`thread_reply`), `source`(`comment`|`page`), `workspaceId/Name`, `pageId/Title`, `blockId`, `fromMemberId`, `commentId`, `previewBody`, `createdAt`, `read`.

- persist 키 `quicknote.notifications.v1`, store version 2 (마이그레이션 `migrateNotificationStore`).
- 최대 `MAX_NOTIFICATIONS = 500`개 유지.
- `blockId === "__page__"` 은 페이지 레벨 댓글 sentinel — 블록 스크롤 없이 페이지로만 이동.
- `addNotification` 은 `(recipient, kind, commentId, workspaceId)` 중복을 dedupe.

## 권위·동기화

서버가 권위. 부트스트랩 시 `fetchMyNotificationsApi` 로 전량 받아 `setNotifications` 로 덮어쓴다. 로컬 액션은 즉시 서버 API를 fire-and-forget 으로 호출(`.catch(() => {})`):

- 항목 클릭/네비게이트 → `markRead` + `markNotificationReadApi`
- 개별 삭제(휴지통) → `removeNotification` + `deleteMyNotificationApi`
- **모두 제거** → `clearAllForMember` + 각 항목 `deleteMyNotificationApi` 반복 (벌크 삭제 API 없음)
- 모두 읽음 → `markAllReadForMember` (로컬만; 서버 일괄 읽음 API 없음)

## 드롭다운 UI 규약

헤더 우측에 `모두 제거`(항목 ≥1) · `모두 읽음`(unread ≥1) 버튼을 나란히 둔다.

리스트 항목 레이아웃(세로 컬럼):
- 상단 메타 행: **보낸 사람 이름(볼드)** 좌측, **페이지 제목 우측 정렬**(`ml-auto`), 워크스페이스 라벨.
- 본문 미리보기 `previewBody` (line-clamp-2).
- 우하단에 휴지통 삭제 버튼(`self-end`, hover 시 노출).
- 읽음 여부는 항목 배경색으로만 구분(미읽음 = emerald 배경). "답글"/"댓글 멘션" 같은 메타 라벨 텍스트·이름 좌측 서클은 표시하지 않는다.

## 네비게이션

항목 클릭 시 `onNavigate`: 워크스페이스 전환 → `waitForPageDeepLink` 로 페이지 로드 대기 → `setCurrentTabPage`/`setActivePage` → `focusNotificationTarget` 으로 블록 스크롤 → 댓글 소스면 `openCommentThread`. 딥링크 흐름은 `navigation/overview.md` 참조.
