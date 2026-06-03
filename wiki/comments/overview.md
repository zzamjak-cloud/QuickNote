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

## AppSync 연동
- 댓글 생성/수정/삭제 → AppSync 뮤테이션
- 실시간 댓글 수신 → AppSync 구독
