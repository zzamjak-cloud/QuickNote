# 검색

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/search/` | 검색 UI, 필터 패널 |
| `src/store/searchFilterPrefsStore.ts` | 검색 필터 설정 |
| `src/lib/search/` | 검색 인덱싱 로직 |

## 동작
- 텍스트 입력 → 페이지 제목·내용 검색
- 필터: 타입별, 날짜별, 워크스페이스별
- `searchFilterPrefsStore` 에 마지막 필터 설정 persist

## 검색 인덱스
`src/lib/search/` — 로컬 검색 인덱스 구축·쿼리
