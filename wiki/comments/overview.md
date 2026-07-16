# 댓글 (Block Comments)

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/comments/` | 댓글 UI 컴포넌트 |
| `src/store/blockCommentStore.ts` | 댓글 스레드 상태 |
| `src/lib/comments/` | 댓글 처리 유틸 |

## 댓글 종류
- **페이지 댓글**: 페이지 레벨 댓글
- **블록 댓글**: 특정 블록에 달린 인라인 댓글

## 주요 동작
- 블록 선택 후 댓글 아이콘 클릭 → 댓글 입력 패널
- 댓글 스레드는 `blockCommentStore` 에서 관리
- 같은 행 댓글 미리보기 카드 겹침 방지: 실측 높이 기반 세로 나열 (commit `cb574c2`)

## 댓글 추가 버튼 위치

"+ 댓글 추가" 버튼은 페이지 제목 표시줄(`PageTitleBar`) 오른쪽 끝 즐겨찾기(Star) 버튼 왼쪽에 위치한다.

- `PageTitleBar`에 `onAddComment?: () => void` prop 추가. 값이 있을 때만 `MessageSquarePlus` 아이콘 버튼 렌더.
- 버튼 클릭 시 부모(`Editor.tsx`, `DatabaseRowPage.tsx`, `DatabaseRowPeek.tsx`)의 `addCommentSignal` 카운터를 +1.
- `PageCommentBar`의 `openComposerSignal?: number` prop이 변경되면 `useEffect`로 작성기(composer)를 열음.
- 댓글 없고 작성기도 닫혀 있으면 `PageCommentBar`는 `null`을 반환(빈 줄 제거).

## AppSync 연동
- 댓글 생성/수정/삭제 → AppSync 뮤테이션
- 실시간 댓글 수신 → AppSync 구독

## 새로고침 시 댓글 소실 회귀 (CRITICAL)

증상: 작성·서버 저장까지 된 댓글이 새로고침(콜드로드) 후 사이드바/스레드에서 모두 사라짐. 서버 `quicknote-comment` 에는 그대로 남아 있음.

원인 체인:
1. `blockCommentStore` 는 `messages` 를 persist 하지 않는다(`partialize` 가 `threadVisitedAt` 만 유지). → 콜드로드마다 댓글 store 가 빈 상태로 시작, 전적으로 서버 재페치에 의존.
2. 부트(`Bootstrap.tsx`)는 페이지/DB 구조 캐시가 있으면 **증분 동기화**(`updatedAfter` = 공유 워터마크 `useSyncWatermarkStore`)를 탄다.
3. 워터마크는 pages/dbs/comments 가 공유한다. 페이지 편집 등으로 워터마크가 최근 시각까지 전진해 있으면 `fetchCommentsByWorkspace(ws, updatedAfter=최근)` 가 워터마크 이전 댓글을 0건 반환한다.
4. `applyRemoteCommentsToStore([])` 는 `length===0` early-return → store 가 영영 빈 채로 남는다.

수정: 부트의 댓글 페치를 공유 워터마크에서 분리해 **항상 전체 조회**한다(`workspaceSnapshotBootstrap.ts` 의 두 경로 모두 `fetchCommentsByWorkspace(workspaceId)` — `updatedAfter` 미전달). 댓글은 로컬 캐시가 없으므로 콜드로드 시 전체 페치가 필요하다.

회귀 주의:
- 댓글 `messages` 를 다시 persist 하지 않는 한, 댓글 페치에 `updatedAfter` 를 넣으면 즉시 재발한다.
- 진단 팁: 브라우저 동적 `import('/src/...')` 는 Vite 에서 앱 번들과 별개 모듈 그래프라 store 직접 읽기가 불가하다(확장자 유무로도 인스턴스가 갈림). `main.tsx` 의 `registerDevTools`(부트 이전 실행)에 계측을 넣어야 앱 인스턴스에 접근할 수 있다.

## 블록 앵커링·댓글 위치 틀어짐 회귀

앵커는 블록 노드의 `attrs.id`(UniqueID 관리) 단일 값이고, 해석(`findBlockStartById`, `blockCommentDecorations`)은 전부 **문서 순서상 첫 매칭**이다. 따라서:

- **복제는 반드시 id 를 벗겨야 한다** — `node.copy()` 로 통째 복제하면 동일 id 블록이 영구 공존하고, 복제본이 원본보다 앞에 오면 댓글이 복제본에 붙는다. 블록 복제(`BlockHandles.duplicateBlock`)·박스선택 Ctrl+D(`useBoxSelectDuplicateBlocks`)는 `cloneWithoutBlockIds`(`src/lib/pm/cloneWithoutBlockIds.ts`) 를 쓴다. 새 복제/삽입 경로를 추가하면 같은 유틸 필수. (paste 는 UniqueID 확장이 `transformPasted` 로 자체 처리, 드래그 **이동**은 id 유지가 올바름 — 댓글이 블록을 따라간다.)
- **스레드 패널은 blockId 해석 우선** — `BlockCommentThreadPanel` 은 open 시점에 캡처한 절대 `payload.blockStart` 가 아니라 `findBlockStartById` 를 우선한다(절대 position 은 원격 편집으로 밀림). 문서 트랜잭션(`docChanged`) 마다 재앵커하며, 이때는 고정 viewport 앵커보다 블록 실좌표를 우선한다.
- Enter 분할 시 id 는 UniqueID 확장이 "내용 블록이 원래 id 유지, 빈 블록에 새 id" 로 처리(빈 앞블록+동일 id 뒷블록 특례 포함) — 원격(y-sync) 트랜잭션에는 appendTransaction 을 돌리지 않으므로 편집한 클라이언트의 배정이 그대로 전파된다.
