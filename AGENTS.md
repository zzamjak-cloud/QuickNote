# QuickNote 프로젝트 가이드

## 언어 규칙
- 모든 코드 주석: **한국어**
- 모든 응답, 커밋 메시지: **한국어**
- 변수명, 함수명 등 식별자: **영어**

---

## 서브에이전트 위임

- 탐색·조사·검증·리뷰·다중 파일 수정처럼 병렬화가 유효한 작업은 사용자에게 매번 별도 허락을 묻지 않고 서브에이전트에 위임할 수 있다.
- 주요 서브에이전트 활용 및 병렬 작업 오케스트레이션은 `superpowers` 대신 OMC(oh-my-Codex)를 우선 사용한다.
- 사용자가 명시적으로 요청하지 않는 한 `superpowers` 기반 워크플로를 기본 서브에이전트 경로로 사용하지 않는다.
- 단, 위임 결과는 그대로 승인하지 말고 메인 컨텍스트에서 최소 검토·통합·검증 후 완료 보고한다.

---

## Wiki

상세 구현 규칙·회귀 방지·배포 절차는 모두 `wiki/` 에 있다.
**작업 전 반드시 해당 카테고리 위키를 먼저 읽을 것.**

### 빠른 진입점

| 작업 | 위키 |
|------|------|
| 팝업/드롭다운 위치 버그 | `wiki/ui/popup-clipping.md` |
| 박스 드래그 선택 버그 | `wiki/ui/box-select.md` |
| 피커뷰 툴바 버그 | `wiki/ui/pickerview-toolbar.md` |
| 이미지 리사이즈 버그 | `wiki/editor/image-resize.md` |
| DB 뷰/셀/필터 수정 | `wiki/database/` |
| 동기화 버그 | `wiki/sync/architecture.md` |
| Zustand persist 버전 bump | `wiki/store/schema-versioning.md` |
| 배포 절차 | `wiki/infra/deploy.md` |
| 버전 bump | `wiki/infra/version-sync.md` |
| 전체 인덱스 | `wiki/README.md` |
