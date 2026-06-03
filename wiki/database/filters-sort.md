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

## 정렬 로직
- 열 ID + direction (asc/desc) 배열
- 복수 정렬 지원

## 뷰별 독립 설정
각 뷰(테이블/타임라인)는 독립적인 필터·정렬 설정을 가짐.
`databaseViewPrefsStore` 에서 `viewId` 키로 분리 저장.
