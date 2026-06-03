# 버전 히스토리

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/history/PageHistoryPreviewDialog.tsx` | 히스토리 미리보기 다이얼로그 |
| `src/components/database/DatabaseBlockHistoryDialog.tsx` | DB 블록 히스토리 다이얼로그 |
| `src/store/historyStore.ts` | 로컬 버전 히스토리 상태 |
| `src/store/serverPageHistoryStore.ts` | 서버 버전 히스토리 상태 |
| `src/lib/history/historyPreviewDiff.ts` | 버전 간 diff 계산 |

## 동작
- 페이지 편집 시 로컬 히스토리 스냅샷 저장 (`historyStore`)
- 서버 히스토리: AppSync 에서 버전 목록 fetch (`serverPageHistoryStore`)
- 히스토리 다이얼로그: 버전 선택 → diff 미리보기 → 복원

## diff 미리보기
`src/lib/history/historyPreviewDiff.ts` — 두 버전 간 변경 내용을 시각화 가능한 형태로 계산
