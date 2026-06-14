# 검색

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/search/` | 검색 UI, 필터 패널 |
| `src/store/searchFilterPrefsStore.ts` | 검색 필터 설정 |
| `src/lib/search/` | 검색 인덱싱 로직 |

## 동작
- 텍스트 입력 → 페이지 **제목**·내용 검색
- 필터: 타입별, 날짜별, 워크스페이스별
- `searchFilterPrefsStore` 에 마지막 필터 설정 persist

## 페이지 제목 유일성

`createPage` / `renamePage` / `duplicatePageToWorkspace` 가 워크스페이스 내 **동일 제목 페이지** 생성을 막거나 `(1)` 접미사로 구분한다 → [pages/overview.md](../pages/overview.md), [store/pageStore.md](../store/pageStore.md). 검색 결과에서 같은 제목이 여러 개 뜨는 혼동을 줄이기 위한 정책이다.

## 검색 인덱스
`src/lib/search/` — 로컬 검색 인덱스 구축·쿼리
