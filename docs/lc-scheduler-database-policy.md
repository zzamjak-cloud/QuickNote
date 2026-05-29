# LC Scheduler Database Policy

LC 스케줄러 DB는 protected DB다. 여기서 protected는 DB 자체의 생명주기와 scheduler 연결을 보호한다는 뜻이며, column 목록과 column 구조를 고정한다는 뜻이 아니다.

## Protected Scope

보호 대상:

- scheduler가 참조하는 DB id 체계
- scheduler workspace scope
- DB 삭제나 local cache cleanup 중 데이터 손실을 막는 guard
- 최초 생성 시 필요한 기본 DB bootstrap

보호 대상이 아닌 것:

- 기본 column 목록
- 기본 column type
- 기본 preset 구성
- row cell 값
- DB title

사용자는 protected DB 안의 column을 일반 DB처럼 수정할 수 있어야 한다. 단, QuickNote 공통 row identity로 쓰이는 `title` column은 기존 앱 공통 규칙에 따라 삭제하거나 다른 type으로 바꾸지 않는다.

## Initial Defaults

기본 구조는 DB가 처음 없을 때만 생성한다. 기존 DB가 있으면 `ensureLC*Database`는 column, preset, title, row cell 값을 덮어쓰지 않는다.

작업 DB 최초 생성 column:

- 작업명
- 작업자
- 기간
- 프로젝트
- 상태
- 근태
- 조직
- 팀
- 마일스톤
- 피쳐
- 카드 색상
- 스케줄러 메타

피처 DB 최초 생성 column:

- 피처
- 마일스톤
- 조직
- 팀
- 프로젝트
- 상태
- 중요도
- 계기
- 진행률
- 작업시작
- 작업종료
- 작업

마일스톤 DB 최초 생성 column:

- 마일스톤
- 상태
- 목표
- 상세
- QA시작
- 서밋
- 출시
- 개발기간
- 조직
- 팀
- 프로젝트
- 정기콘텐츠
- 프로젝트진행률
- OS
- 참여자
- 연결 페이지

## Why Defaults Are Not Reapplied

초기 default는 scheduler 기능을 처음 사용할 수 있게 만드는 bootstrap이다. 이후에는 사용자가 업무 방식에 맞게 DB를 바꾸는 것이 정상 흐름이다.

따라서 다음 동작은 금지한다.

- 앱 시작 또는 scheduler 진입 시 기본 column을 기존 DB에 재병합
- 기존 page link column을 다른 type으로 되돌리기
- 사용자가 삭제한 기본 column을 자동 복구
- preset을 기본값으로 재정렬하거나 덮어쓰기
- 근태 row title 또는 cell 값을 자동 migration으로 바꾸기

필요한 schema 보정이 있더라도 사용자 데이터를 덮어쓰는 방식이 아니라 명시적 migration과 테스트를 통해 처리한다.

## Safe Change Checklist

LC scheduler DB 관련 변경 시 확인한다.

- 기존 protected DB의 사용자 column 수정이 유지되는지 테스트한다.
- 최초 생성 DB에는 필요한 default column이 생성되는지 테스트한다.
- `title` column 공통 보호를 제외한 scheduler 전용 required column 제한이 다시 생기지 않았는지 확인한다.
- page link, item fetch, progress source config가 persist/GQL/sync 경로에서 보존되는지 확인한다.
- local delete guard가 protected DB 삭제 또는 workspace 전환 중 데이터를 잘못 제거하지 않는지 확인한다.

## Runtime Cautions

다음 코드는 static unused tool에서 false positive가 나올 수 있으므로 삭제 전 runtime 경로를 확인한다.

- scheduler protected DB id helper
- AppSync resolver의 scheduler scope guard
- page link search popup의 milestone/feature DB prefix filter
- scheduler modal과 DB manager의 lazy ensure call
