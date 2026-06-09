# DB 필터 & 정렬

## 상태 저장 위치
`src/store/databaseViewPrefsStore.ts`
- `filters`: 활성 필터 배열
- `sorts`: 정렬 규칙 배열
- `hiddenColumns`: 숨긴 열 ID 목록

## 필터 로직
`src/lib/database/` 내 필터 쿼리 함수
- 각 셀 타입별 필터 연산자 정의 (contains, equals, isEmpty 등)
- 필터는 AND 조합
- DB row 후보군은 `bundle.rowPageOrder` + `databaseRowIndexStore` snapshot을 합쳐 만든다. 아직 본문이 로드되지 않은 cached-only row도 title/dbCells 기준 필터·검색 대상이어야 한다.
- `sourceFromDb`, `pageLinkMirror`, `itemFetch` 같은 자동화/미러 컬럼은 raw `dbCells` 대신 실효 셀값을 해석해 필터·검색한다.
- pageLink 검색 팝업의 조직/팀/프로젝트/마일스톤/피처 단계 필터도 자동화 실효값을 기준으로 후보를 좁힌다.

## 정렬 로직
- 열 ID + direction (asc/desc) 배열
- 복수 정렬 지원
- `useProcessedRows`는 화면에 쓰는 실효 셀값을 계산한 뒤 정렬한다. 자동화/미러 컬럼은 raw 값만으로 정렬하지 않는다.
- `pageStore`의 실제 page가 있으면 우선 사용하고, 없으면 row index entry의 `title`, `icon`, `order`, `dbCells`를 fallback으로 사용한다.

## 관련 문서
- [row-index-cache.md](row-index-cache.md)

## 뷰별 독립 설정
각 뷰(테이블/타임라인)는 독립적인 필터·정렬 설정을 가짐.
`databaseViewPrefsStore` 에서 `viewId` 키로 분리 저장.
