# 공유 드롭다운 메뉴·갤러리 블록

`dropdownMenuBlock`과 `galleryBlock`은 여러 페이지에 복사한 뒤에도 같은 내용을 유지하는 공유 블록이다. 플로우차트와 같은 `공유 id + 인라인 스냅샷` 계약을 사용하며, 블록의 페이지 내 위치는 동기화하지 않는다.

## 데이터 권위와 동기화

- TipTap attrs: `sharedBlockId`, `data`, `version`, `publicMode`, `autoOpenEditor`, `align`.
- 권위 데이터: 서버 `SharedBlock` 레코드와 이를 반영한 `sharedBlockStore`의 `SharedBlockRecord`.
- 인라인 `data`: 오프라인·서버 미배포 fallback 및 최초 시드.
- store key는 `[workspaceId, sharedBlockId]` 복합 키다. 같은 id가 다른 워크스페이스 캐시와 섞이지 않는다.
- 같은 `sharedBlockId`를 가진 마운트된 복제본은 Zustand 레코드를 함께 구독하므로 서버 저장 성공 직후 모두 다시 렌더된다.
- 마운트 시 `fetchSharedBlockApi`, 저장 시 `pushSharedBlockApi`, 원격 병합은 `updatedAt` LWW다. upsert 응답의 서버 승자를 다시 store에 반영해 동시 편집도 수렴시킨다.
- AppSync `AWSJSON`이 직렬화 문자열을 한 번 더 감싼 응답도 최대 두 번까지 해제한다. 이 방어가 없으면 서버에는 메뉴·이미지가 저장돼도 클라이언트가 빈 공유 블록으로 해석해 화면과 인라인 스냅샷을 비우게 된다.
- 복사/붙여넣기와 페이지 복제는 `sharedBlockId`를 유지한다. `attrs.id`만 제거하는 기존 블록 복사 규칙을 바꾸지 않는다.
- 편집 팝업은 로컬 draft를 사용하고 `변경사항 저장` 시에만 공유 레코드를 원자적으로 갱신한다. 서버 저장 실패 시 팝업을 닫거나 복제본을 먼저 갱신하지 않고 재시도 오류를 표시한다.
- `align`은 각 페이지의 배치 속성으로 `left | center | right`를 사용한다. 공유 메뉴 내용과 분리해 드래그 핸들 메뉴에서 현재 블럭만 정렬한다.

## 드롭다운 메뉴

- 각 항목은 `label`, `pageId`, 편집 표시용 `pageLabel`을 가진다.
- 편집 버튼은 블록 우측에 고정하지 않는다. 편집 가능 모드에서 드롭다운 목록을 열면 목록 상단 우측에 `편집` 버튼을 sticky 로 표시하고, 공개 페이지에서는 숨긴다.
- 편집 팝업에서 메뉴 추가·삭제·위/아래 순서 변경·페이지 멘션 연결을 제공한다.
- 빈 이름·미연결 항목·같은 페이지 중복 연결은 저장할 수 없다.
- 현재 페이지 항목을 트리거 라벨로 표시하되, 목록 안에는 텍스트만 표시한다.
- 현재 페이지 항목도 클릭을 막지 않고 연결된 페이지를 다시 연다.
- 메뉴 본체는 행 전체가 아니라 현재 메뉴 텍스트와 편집 버튼 너비에 맞게 표시한다.
- 메뉴 트리거와 목록은 텍스트 중심의 낮은 높이 UI로 유지하고, 언어/번역 전용 아이콘을 고정 노출하지 않는다.
- 메뉴 버튼 클릭은 블럭 선택처럼 보이지 않아야 하므로 atom 선택의 행 전체 파란 배경은 숨긴다.
- 팝업은 `useAnchoredPopover` + body Portal을 사용해 편집기 overflow와 화면 가장자리에서 잘리지 않게 한다.

## 갤러리

- 새 블록 삽입 직후 편집 팝업을 한 번 자동으로 연다.
- PNG/JPEG/WebP 다중 추가, 대체 텍스트, 삭제, 위/아래 순서 변경, 3/5/8/10초 전환 간격을 지원한다.
- 편집 팝업에서 블록 높이를 180~800px 범위(20px 단위)로 설정한다. 레거시 데이터는 기본 320px로 복원하며 높이도 이미지·순서와 같은 공유 데이터로 저장해 모든 복제본에 동기화한다.
- 롤링 이미지는 설정 높이 안에서 `object-contain`으로 표시해 원본 비율과 전체 영역을 보존한다. 남는 영역은 갤러리 배경색으로 채운다.
- 배너는 오른쪽의 다음 이미지가 들어오며 현재 이미지가 왼쪽으로 나가는 슬라이드 방식이다.
- 이미지가 한 장이면 자동 전환과 인디케이터를 만들지 않는다.
- hover, 수동 일시정지, 문서 탭 비활성, 이미지 미리보기 중에는 자동 전환을 멈춘다. 미리보기를 닫으면 기존 수동 일시정지 상태가 아닌 경우 재개한다.
- 마지막 이미지 뒤에는 첫 이미지 clone을 한 번 더 배치하고, 전환 완료 뒤 transition 없이 원점으로 되돌려 마지막→첫 이미지도 항상 우측에서 좌측 방향으로 이동한다.
- `prefers-reduced-motion: reduce`에서는 자동 전환과 슬라이드 transition을 끈다.
- 이미지 클릭 시 포커스 트랩·Escape·닫기·이전/다음 조작이 있는 미리보기 dialog를 연다.

## 공개 페이지

- public-view Lambda가 페이지 doc의 `sharedBlockId`를 서버 최신 레코드로 hydrate한다. 다른 복제본의 오래된 인라인 스냅샷을 그대로 공개하지 않는다.
- 드롭다운은 현재 게시 루트의 자손 집합에 포함된 항목과, 같은 워크스페이스에서 대상 페이지 자체가 별도 게시 중인 항목만 남긴다.
- 현재 트리 항목은 `/p/<현재 token>?page=<id>`로 SPA 이동한다. 독립 게시 항목은 public-view Lambda가 `published-pages.byPageId`의 active token과 공개 가능한 페이지 메타를 검증해 만든 `/p/<대상 token>`으로 같은 탭 전체 이동한다.
- `published-pages.byPageId` 조회의 `ProjectionExpression`에서는 DynamoDB 예약어인 `token`을 반드시 `#token`으로 별칭 처리한다. 조회 실패는 메뉴 항목을 fail-closed로 숨기므로 별칭 회귀가 곧 "자기 자신만 표시" 증상으로 이어진다.
- 미게시·게시 해제·삭제·DB 행·타 워크스페이스 항목은 메뉴 이름과 id까지 응답하지 않는다. SharedBlock 저장 data에 들어 있는 `href`는 신뢰하지 않고 서버 파생 링크만 허용한다.
- 문서 순회 깊이 상한을 넘은 서브트리는 원본 attrs를 반환하지 않고 제거한다. 깊은 stale 메뉴의 비공개 label/pageId도 Function URL 원문에 남지 않는다.
- `transformPublicDoc`은 서버 검증 링크만 보존하고 `publicMode`를 켠다. 편집 화면은 `href` 대신 기존 `pageId` 기반 QuickNote 내부 이동을 계속 사용한다.
- 갤러리 `quicknote-image://` ref는 `op=asset` URL로 변환하고 서버에서 정규화한 사용자 높이를 유지한다. public asset 허용 목록도 hydrate된 갤러리 payload를 검사해야 한다.
- 공유 갤러리 자산은 `sharedGallery` 합성 AssetUsage를 SharedBlock 버전과 함께 유지한다. 한 복제본 페이지가 삭제되어도 남은 복제본의 최신 공유 자산 권한이 사라지지 않는다.
- 자산 관리의 사용 위치에서는 `sharedGallery` 합성 사용처를 `공유 갤러리`로 표시하고, 합성 pageId를 실제 페이지처럼 열지 않는다.
- 공개 모드에서는 편집 버튼과 인증 API/store fetch를 사용하지 않는다.
- 공개 뷰어 shell은 `h-dvh overflow-y-auto` 스크롤 컨테이너다. 경로/목차 헤더는 이 컨테이너 안에서 sticky 되고, 목차 이동과 Top 버튼도 같은 컨테이너를 스크롤한다.
- 공개 페이지 데이터 fetch는 서버 `Cache-Control`을 활용한다. 클라이언트에서 `cache: "no-store"`를 강제하지 않는다. 기본 응답은 브라우저 30초, 공유 캐시/CDN 300초(`s-maxage`)와 `stale-while-revalidate`를 사용한다.
- 공개 링크의 `token`은 capability 이므로 한번 발급된 뒤 유지한다. 게시 후 수정/레이아웃 변경은 같은 token의 `snapshotVersion`/S3 key만 교체해 반영한다.
- `published-pages` 레코드에 `snapshotVersion`, `snapshotSiteKey`, `snapshotPageKeyPrefix`, `snapshotCreatedAt`, `snapshotPageCount`를 저장한다. public-view Lambda는 이 스냅샷을 우선 반환하고, 없거나 읽기 실패하면 기존 Pages/SharedBlock 조립 경로로 fallback 한다.
- 게시 다이얼로그의 `스냅샷 업데이트`는 새 링크를 만들지 않고 `publishPage(pageId, layout)`을 다시 호출해 현재 본문·공유블록·레이아웃의 공개 스냅샷만 갱신한다.
- 공개 레이아웃 스냅샷 갱신은 `publishPage(pageId, layout)`에 현재 `fullWidth/fullWidthDefault/fullWidthById`를 함께 전달한다. 서버가 방금 저장한 member `clientPrefs`를 stale read 하면 특정 게시 페이지가 계속 전체 너비로 남을 수 있으므로, payload 없는 레거시 호출만 `clientPrefs` 폴백을 사용한다.

## 관련 파일

### 클라이언트

- `src/types/sharedBlock.ts`
- `src/store/sharedBlockStore.ts`
- `src/lib/sync/queries/sharedBlock.ts`
- `src/lib/sync/sharedBlockApi.ts`
- `src/lib/tiptapExtensions/sharedBlocks.tsx`
- `src/components/sharedBlocks/SharedBlockView.tsx`
- `src/lib/publicView/transformPublicDoc.ts`
- `src/lib/publicView/publicLinks.ts`
- `src/components/public/PublicPageViewer.tsx`

### 서버

- `infra/lib/sync/schema.graphql`
- `infra/lambda/v5-resolvers/handlers/sharedBlock.ts`
- `infra/lambda/public-view/index.ts`
- `infra/lambda/public-view/sharedBlocks.ts`
- `infra/lambda/public-view/docAssets.ts`
- `infra/lib/sync-stack.ts`

## 회귀 검증

1. 같은 블록을 두 페이지에 복사하고 한쪽 저장 직후 다른 쪽이 같은 순서·내용으로 갱신되는지 확인.
2. 새로고침 후 서버 최신본이 복원되는지 확인.
3. 공개 드롭다운에서 트리 안 항목은 현재 token SPA 이동, 같은 workspace의 독립 게시 루트는 대상 token 같은 탭 이동을 하는지 확인. 미게시·해제·삭제·DB 행·타 workspace 항목은 보이지 않아야 한다.
4. 갤러리 높이 변경이 복제본·새로고침·공개 화면에서 동일하게 유지되고, 서로 다른 비율의 이미지가 잘리지 않는지 확인.
5. 공개 갤러리 이미지가 302 presign 되고, 미리보기 중 자동 전환이 멈추는지 확인.
6. 375px 화면, 키보드만 사용, reduced motion 설정에서 높이 조절·팝업·롤링·미리보기를 확인.
7. 동시 저장에서 서버 LWW 승자가 모든 마운트 복제본에 반영되고, 서버 실패 시 편집 팝업이 열린 채 오류를 표시하는지 확인.
8. 같은 `sharedBlockId`를 가진 서로 다른 워크스페이스 캐시가 분리되는지 확인.
