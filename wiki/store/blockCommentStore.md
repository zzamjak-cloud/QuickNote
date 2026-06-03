# blockCommentStore

## 역할
블록 단위 댓글(스레드) 메시지와 읽음 상태를 관리하는 스토어. 메시지는 Page JSON에 임베딩되지 않고 AppSync Comment 테이블과 직접 동기화된다.

## 위치
`src/store/blockCommentStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `messages` | `BlockCommentMsg[]` | 전체 댓글 메시지 목록 |
| `threadVisitedAt` | `Record<string, number>` | 스레드 키(`pageId:blockId`) → 마지막 방문 시각(epoch ms). 디바이스 로컬만 유지 |

**`BlockCommentMsg`** 주요 필드: `id`, `workspaceId`, `pageId`, `blockId`, `authorMemberId`, `bodyText`, `mentionMemberIds`, `parentId`, `createdAt`

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `addMessage` | `input` | 새 댓글 추가 및 AppSync enqueue. 중복 ID면 기존 반환 |
| `updateMessage` | `id, patch` | 댓글 본문·멘션 수정 |
| `deleteMessage` | `id` | 로컬에서 댓글 제거 |
| `removeMessage` | `id` | 원격 softDelete 수신 시 제거 (storeApply 전용) |
| `applyRemoteMessage` | `msg` | 원격 수신 메시지 upsert (storeApply 전용) |
| `messagesForBlock` | `pageId, blockId` | 특정 블록의 댓글 목록 반환 |
| `participantIdsForBlock` | `pageId, blockId` | 특정 블록 스레드 참여자 ID 목록 반환 |
| `markThreadVisited` | `pageId, blockId` | 스레드 읽음 시각 갱신 |
| `hasUnreadFromOthers` | `pageId, blockId, myMemberId` | 본인 외 작성자의 미읽은 댓글 존재 여부 |
| `clearMessages` | 없음 | 워크스페이스 전환 시 메시지 전체 초기화 |

## Persist

- localStorage 키: 별도 persist 키 존재 (v1 레거시 마이그레이션에서 `messages`는 더 이상 저장하지 않음)
- `messages`는 현재 persist 대상에서 제외 — 앱 재시작 시 AppSync에서 재페치
- `threadVisitedAt`만 로컬 persist 유지 (서버 미동기)
- `migrateBlockCommentStore`: 레거시 호환용 no-op 함수

## 의존 관계

- `workspaceStore` — `getCurrentWorkspaceId()` 로 현재 워크스페이스 필터링
- `pageStore` — 댓글 추가 시 페이지 멘션 알림 트리거
- `notificationStore` — 멘션 알림 생성
- `src/lib/sync/runtime.ts` — `enqueueAsync` 로 AppSync 뮤테이션 enqueue
- `src/lib/comments/mentionMemberIds.ts` — `normalizeMentionMemberIds`

## 사용처 (주요 컴포넌트)

- `src/lib/sync/storeApply.ts` — 원격 댓글 이벤트 적용 (`applyRemoteMessage`, `removeMessage`)
- `src/components/BlockCommentThread.tsx` (또는 유사 컴포넌트) — 댓글 스레드 UI
- 에디터 블록 노드 뷰 — 댓글 존재·미읽음 배지 표시 (`hasUnreadFromOthers`)
