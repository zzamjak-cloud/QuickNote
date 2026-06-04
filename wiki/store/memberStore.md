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

## CRITICAL 회귀 주의 — 멘션/검색은 캐시 전용

멤버 정보는 설정팝업 변경 시 즉시 이 캐시에 반영되므로(`AdminMembersTab` 의 `upsertMember`, 단일 `getWorkspaceMeta` API), **멘션·인물셀 자동완성은 로컬 캐시(`filterWorkspaceMembersForMention`)만으로 처리한다. 키 입력마다 서버를 호출하지 말 것.**
- `src/components/database/cells/PersonCell.tsx` — 로컬 필터만. 이전엔 키 입력마다 `searchMembersForMentionApi`(AppSync→Lambda→Members Scan) 를 쳐 비용이 컸다.
- `src/lib/comments/mentionItems.ts` — `isMemberCacheFresh()`(멤버 캐시 비어있지 않고 `WORKSPACE_META` TTL 내)면 원격 검색 생략. 원격은 캐시가 비었거나 만료됐을 때만 fallback.
- 검색 기능(`src/lib/search/`)은 원래부터 완전 로컬 인덱스 — 서버 호출 없음. 페이지/DB 멘션 후보도 `usePageStore`/`useDatabaseStore` 로컬.
