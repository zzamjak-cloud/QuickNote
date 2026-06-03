# memberStore

## 역할
현재 워크스페이스의 멤버 목록과 로그인한 본인 정보, 멘션 후보 캐시를 관리하는 스토어.

## 위치
`src/store/memberStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `me` | `Member \| null` | 현재 로그인한 멤버 정보 |
| `members` | `Member[]` | 워크스페이스 전체 멤버 목록 |
| `cacheWorkspaceId` | `string \| null` | 캐시된 멤버들이 속한 워크스페이스 ID |
| `lastFetchedAt` | `number \| null` | 마지막 페치 시각 (epoch ms) |
| `mentionCandidates` | `MemberMini[]` | 멘션 검색 결과 후보 |
| `mentionQuery` | `string` | 현재 멘션 검색 쿼리 |

**`Member`** 필드: `memberId`, `email`, `name`, `workspaceRole: MemberRole`, `status: MemberStatus`

**`MemberRole`**: `"developer"` \| `"owner"` \| `"leader"` \| `"manager"` \| `"member"`

**`MemberStatus`**: `"active"` \| `"removed"`

**`MemberMini`** 필드: `memberId`, `name` (멘션 UI용 경량 타입)

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `setMe` | `member` | 본인 정보 설정 |
| `setMembers` | `members, workspaceId?` | 전체 멤버 목록 교체 및 `lastFetchedAt` 갱신 |
| `upsertMember` | `member` | 특정 멤버 추가 또는 갱신. `me`도 동기 갱신 |
| `removeMemberFromCache` | `memberId` | 캐시에서 멤버 제거 (멘션 후보 포함) |
| `setMentionCandidates` | `query, candidates` | 멘션 검색 결과 설정 |
| `clearMentions` | 없음 | 멘션 쿼리·후보 초기화 |
| `clear` | 없음 | 전체 상태 초기화 |

## Persist

- localStorage 키: `quicknote.members.cache.v1`
- storage: `zustandStorage`
- 저장 필드: `me`, `members`, `cacheWorkspaceId`, `lastFetchedAt`
- `mentionCandidates`, `mentionQuery`는 저장하지 않음
- version: 없음 (단순 구조, 모든 필드가 선택적으로 처리 가능)

## 의존 관계

- `src/lib/storage/index.ts` — `zustandStorage`
- `workspaceStore` — 워크스페이스 전환 시 `clear()` 후 재페치 필요

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 로그인 후 멤버 목록 페치 및 `setMembers`, `setMe` 호출
- `src/lib/tiptapExtensions/mention/` — 멘션 후보 검색 및 표시
- `src/store/pageStore/helpers.ts` — `getCurrentMemberId()`, `getCreatedByMemberId()` 에서 참조
- `src/lib/sync/storeApply.ts` — 원격 멤버 변경 이벤트 적용
