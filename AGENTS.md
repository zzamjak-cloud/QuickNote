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

## 브랜치·라이브 배포 보호 규칙

- 기본 작업 브랜치는 **반드시 `develop`** 이다. 사용자가 라이브 빌드 문제를 말하더라도 즉시 `main`에서 작업하거나 `main`에 직접 반영하지 않는다.
- `main`은 라이브/프로덕션 브랜치로 간주한다. 사용자의 현재 턴 명시 승인 없이 `main` checkout, commit, merge, rebase, tag, push, 배포를 수행하지 않는다.
- 라이브 이슈 수정도 먼저 `develop`에서 구현하고, dev 빌드에서 재현·검증한다. dev 검증 없이 `main` 또는 live 환경을 건드리지 않는다.
- `develop`을 거치지 않은 `main` 직접 push는 금지한다. release/promote 단계가 필요하면 `develop` 최신 상태와 dev 검증 결과를 확인한 뒤 사용자에게 명시 승인을 받아 진행한다.
- 브랜치가 꼬였거나 `main`이 `develop`보다 앞서 있는 상황을 발견하면 임의로 맞추지 말고, 현재 상태와 필요한 정리 절차를 보고하고 사용자 확인을 받는다.

---

## Wiki

상세 구현 규칙·회귀 방지·배포 절차는 모두 `wiki/` 에 있다.
**작업 전 반드시 해당 카테고리 위키를 먼저 읽을 것.**

---

### 빠른 진입점

| 작업 | 위키 |
|------|------|
| 팝업/드롭다운 위치 버그 | `wiki/ui/popup-clipping.md` |
| 박스 드래그 선택 버그 | `wiki/ui/box-select.md` |
| 피커뷰 툴바 버그 | `wiki/ui/pickerview-toolbar.md` |
| 멘션·링크 클릭 이동/Ctrl+클릭/뒤로가기/탭 닫기 | `wiki/navigation/overview.md` |
| 이미지 리사이즈 버그 | `wiki/editor/image-resize.md` |
| DB 뷰/셀/필터 수정 | `wiki/database/` |
| DB 그룹화(표시설정) | `wiki/database/grouping.md` |
| 자산 관리 탭·캐싱 | `wiki/settings/assets.md` |
| 동기화 버그 | `wiki/sync/architecture.md` |
| Ghost 페이지(풀페이지 DB 사이드바 중복)·진입 시 재생성 | `wiki/pages/ghost-page-prevention.md` |
| 워크스페이스 진입 화면/첫 인덱스 리셋 | `wiki/workspace/overview.md` |
| 버전 히스토리(페이지/DB·복원·삭제) | `wiki/history/overview.md` |
| Zustand persist 버전 bump·워크스페이스 스냅샷 키 | `wiki/store/schema-versioning.md` |
| 배포 절차 | `wiki/infra/deploy.md` |
| 버전 bump | `wiki/infra/version-sync.md` |
| 전체 인덱스 | `wiki/README.md` |
