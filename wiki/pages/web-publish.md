# 웹 퍼블리싱 (publish to web)

노션식 "웹에 게시" — 페이지를 게시하면 **해당 페이지 + 모든 자손**을 로그인 없이 누구나
읽기 전용으로 볼 수 있다. 항상 최신 본문(라이브), noindex, URL 은 추측 불가 토큰.

## 아키텍처

| 구성 | 위치 |
|------|------|
| 게시 토큰 테이블 | DDB `published-pages` (PK `token`, GSI `byPageId`) — `sync-stack.ts` |
| 게시/해제/상태 API (Cognito) | `infra/lambda/v5-resolvers/handlers/publishedPage.ts` — `publishPage`/`unpublishPage`(edit)·`getPagePublishStatus`(view) |
| 공개 조회 Lambda | `infra/lambda/public-view/` — **Function URL(authType NONE)**, `op=site`/`op=page`/`op=asset` |
| 공개 뷰어 | `/p/<token>` → `src/components/public/PublicPageViewer.tsx` (Bootstrap 에서 분기) |
| doc 변환 | `src/lib/publicView/transformPublicDoc.ts` |
| 게시 UI | TopBar "..." 메뉴 → `src/components/layout/PublishDialog.tsx` |

## 보안 규칙 (회귀 주의)

- **균일 404**: public-view 는 미존재/해제/삭제/트리 밖 전부 동일한 404 — 존재 여부 오라클 차단.
- **IDOR 방어선**: `op=page`/`op=asset` 은 ① `page.workspaceId === publish.workspaceId`
  ② 루트 BFS 자손 집합 포함 확인을 모두 통과해야 한다. **이 검사를 약화시키지 말 것.**
- **BFS 는 visited + 상한 필수** (`tree.ts` `TREE_NODE_MAX`) — 클라이언트 `isDescendant` 는
  순환 가드가 없으므로 서버로 이식 금지.
- **presign 화이트리스트**: `op=asset` 은 해당 페이지 doc(+icon/coverImage)에서 추출된
  assetId 만 presign(`docAssets.ts`). 임의 assetId presign 금지. TTL 300s.
- **필드 화이트리스트**: Pages 조회는 ProjectionExpression — `dbCells`·`blockComments`·
  `lastEditedBy*` 는 공개 응답에 절대 포함하지 않는다.
- 재게시는 항상 **새 토큰**. publish 는 멱등(active 있으면 그대로 반환).
- 삭제·트리 밖 이동은 요청 시점 BFS 에서 자동 반영(라이브). 캐시 `max-age=60` 만큼 지연 허용.
- mention attrs 의 멤버 이름은 구조적으로 공개됨 — PublishDialog 에 경고 문구 존재.

## 프론트 규칙

- `Bootstrap.tsx`: `/p/` 분기는 `useSyncBootstrap()` 을 호출하는 `AuthedBootstrap` **바깥**에서
  일어난다(훅 규칙). 공개 뷰어에 인증/스토어 부트스트랩을 붙이지 말 것.
- 렌더는 `BlockDiffView` 의 read-only TipTap 레시피 재사용(`useEditorExtensions` 전부 null).
- **좌측 트리 사이드바를 두지 않는다** — 공개 웹은 본문만 표시. 자손 이동은 본문
  `pageLink`(공개 라우트 링크) 클릭으로만 한다.
- 페이지 아이콘: `PageIconDisplay`/`useImageUrl`(Cognito) 대신 공개용 `PublicPageIcon` —
  Lucide·이모지·`op=asset` 이미지 URL. 인증 훅을 공개 뷰어에 붙이지 말 것.
- 본문 `pageLink` 클릭: TipTap `Link.openOnClick:false` 이므로 `ReadOnlyDocView` 의
  `handleDOMEvents.click` 에서 `/p/<token>?page=` 만 `navigateTo` 로 연결한다.
- doc 변환: 자산 스킴 → `op=asset` URL(이미지 블록 무수정), `databaseBlock`/`flowchartBlock`
  → placeholder, `pageLink` → 트리 안=공개 라우트 링크 텍스트 / 밖=순수 텍스트(id 비노출).
- `VITE_PUBLIC_VIEW_URL` (Function URL) — 미설정이면 뷰어는 404 화면. CSP `connect-src` 에
  해당 호스트 핀 고정 필요(`vercel.json`). 도메인 변경 시 env·CSP 동시 갱신.

## 테스트

- `infra/lambda/public-view/index.test.ts` — 균일 404·트리 소속·자산 인가·필드 미노출·순환 종료
- `infra/lambda/v5-resolvers/handlers/publishedPage.test.ts` — 멱등·권한·해제
- `src/lib/publicView/__tests__/transformPublicDoc.test.ts` — 치환·강등

## 배포 체크리스트

1. CDK(dev→live) 배포 후 `PublicViewUrl` output 확보
2. `.env`(dev)·Vercel env(prod)에 `VITE_PUBLIC_VIEW_URL` 설정
3. **`vercel.json` `connect-src` 에 Function URL 호스트 추가(dev/prod 2개 모두)** —
   dev/live 스택의 public-view Function URL 은 서로 다르다. **prod 호스트를 빠뜨리면
   `quick-note-khaki.vercel.app/p/<token>` 에서 fetch 가 CSP 에 막혀 뷰어가 항상
   "페이지를 찾을 수 없습니다" 로 죽는다.** live 배포 시 반드시 prod Function URL 을 추가할 것.
4. curl 검증: 유효/무효 토큰, 형제 pageId 거부, revoked 404, **타 워크스페이스 자산 404**

## 알려진 한계·후속

- **공개 링크 도메인**: `buildPublicPageUrl` 은 웹 배포에서는 **현재 origin**, 로컬·데스크톱만
  `VITE_WEB_APP_ORIGIN`(미설정 시 khaki). develop 게시를 khaki 로 강제하면 토큰(dev DB)과
  Lambda(prod) 가 어긋나 "페이지를 찾을 수 없습니다" 가 난다.
- **Vercel Deployment Protection(SSO)**: Preview(`/quick-note-git-develop-…`) 는 익명
  `/p` 접근이 로그인으로 막힐 수 있다. **시크릿 창 검증·외부 공유는 라이브(khaki)에서
  게시한 링크**를 쓸 것. Preview 는 로그인된 개발자 확인용.
- **op=asset 효율**: 이미지 많은 공개 페이지는 자산마다 왕복(토큰·페이지·AssetUsage·asset)이 발생.
  `reservedConcurrentExecutions=10` 이라 동시 열람이 많으면 스로틀될 수 있다. 필요 시
  (token,pageId)별 자산 화이트리스트 단기 메모 또는 op=page 응답에 presign 동봉으로 개선.
