# 설정 — 자산 관리 탭

설정 모달의 "자산" 탭 — 사용자가 업로드한 모든 자산(이미지·동영상·파일)을 확인·검색·삭제하고 사용 위치를 추적하는 관리 UI.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/components/settings/AdminAssetsTab.tsx` | 자산 관리 탭 UI (검색·필터·정렬·가상 스크롤·다중 삭제·사용 위치) |
| `src/store/assetCacheStore.ts` | 자산 목록 **세션 캐시**(서버 호출 최소화) |
| `src/lib/sync/assetApi.ts` | `listMyAssets`/`deleteMyAssets`/`getAssetUsages`/`renameAsset`/`migrateAssetUsage` GraphQL 래퍼 |
| `src/lib/sync/queries/asset.ts` | GraphQL operations + `GqlAsset` 타입 |
| `src/lib/images/registry.ts` | 썸네일·미리보기용 presign URL 캐시(`imageUrlCache`) → [editor/images.md](../editor/images.md) |
| `src/lib/assets/customIconAssetProtection.ts` | 커스텀 아이콘으로 등록된 자산 삭제 보호 |

## 데이터 로딩 — 세션 캐시 (서버 비용 최소화)

자산 목록은 `assetCacheStore`(앱 세션 메모리, **디스크 persist 안 함**)에 캐싱한다. `listMyAssets`는 사용자 전역 쿼리라 워크스페이스와 무관하게 단일 캐시를 쓴다.

핵심 정책:
- **탭 진입마다 서버를 호출하지 않는다.** 마운트 시 `ensureLoaded()`는 캐시가 비었을 때만 1회 로드하고, 이후 재진입은 캐시를 재사용한다.
- **갱신은 "새로고침" 버튼(`refresh()`)으로만** 일어난다. 삭제·이름변경은 서버 재요청 없이 캐시에 직접 반영(`removeMany`/`patchOne`). 인덱스 재구성 후에는 usageCount 변동 때문에 `refresh()`로 강제 재로드한다.
- **페이지네이션 로드**: `nextToken` 으로 200건씩 나눠 받아 누적(점진 표시). 단일 거대 쿼리 페이로드·Lambda 부담을 낮춘다.
- **필터·정렬·검색은 전부 클라이언트 처리**: 정렬(크기/업로드일)·MIME·"사용 안 됨만"·최소 크기·검색을 캐시된 전체 목록에서 계산한다. 필터를 바꿔도 **서버 호출이 발생하지 않으므로** minSize 입력 등에서 연쇄 요청이 없다(디바운스 불필요).
- 동시 호출(StrictMode 이중 마운트 등)은 인플라이트 공유 프라미스로 중복 로드를 차단한다.

### "사용 안 됨만" 기본값
탭의 주 용도가 미사용 리소스 정리이므로 `unusedOnly` 초기값은 **true**. 미사용 판정은 `usageCount === 0` + 커스텀 아이콘 보호 자산 제외(클라이언트). 기본 화면에서 사용 중 자산을 숨겨 썸네일 presign 호출도 줄인다.

### 트레이드오프 (의도된 동작)
- 클라이언트 필터링을 위해 첫 로드는 사용 중 자산까지 **전체**를 받는다(세션 1회).
- 캐시는 새로고침 전까지 유지되므로 **다른 기기/탭에서 업로드한 자산은 새로고침해야 반영**된다(요청된 "새로고침 전용 갱신" 정책).

## 썸네일·미리보기
- 행별 썸네일(`AssetThumb`)·미리보기 모달은 `imageUrlCache.get(assetId)`로 presign URL을 받아 표시한다. 가상 스크롤이라 **보이는 행만** 요청하고 결과는 캐시된다 → [editor/images.md](../editor/images.md).

## 삭제
- 다중 선택 후 영구 삭제. Lambda 처리량 한도 회피를 위해 30개 청크로 분할 호출하고 실패는 부분 성공으로 누적.
- 커스텀 아이콘 등록 자산은 선택·삭제가 차단된다(`customIconAssetProtection`).

## 회귀 주의
- `assetCacheStore`는 **persist 하지 않는다**(세션 메모리). 디스크 캐시로 바꾸면 stale 자산이 남을 수 있다.
- 자산을 변경하는 모든 액션(삭제·이름변경·인덱싱)은 캐시(`removeMany`/`patchOne`) 또는 `refresh()`로 반드시 동기화해야 화면과 캐시가 어긋나지 않는다.
- 필터/정렬을 서버로 되돌리려면 `listMyAssetsApi`의 `sortBy`/`filterMimePrefix`/`filterUnusedOnly`/`minSize` 입력을 다시 사용하면 되지만, 그 경우 캐시 정책(필터별 캐시 키)도 함께 재설계해야 한다.
