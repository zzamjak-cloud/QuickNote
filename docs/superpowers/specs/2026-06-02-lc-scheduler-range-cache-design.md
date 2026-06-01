# LC Scheduler Range Cache Design

## 목표

LC Scheduler가 연 단위 전체 일정을 매번 서버에서 재구성하지 않도록, 사용자가 실제로 보는 월 주변부만 조회하고 과거 데이터는 로컬 캐시에서 재사용한다.

## 핵심 결정

- Page/Database는 계속 LC Scheduler의 원본 데이터로 유지한다.
- 기존 `Schedules` DynamoDB 테이블과 `byWorkspaceAndStartAt` GSI를 LC schedule page의 read index로 재사용한다.
- 일정 page가 저장되거나 삭제될 때 서버 resolver가 해당 page의 schedule index row를 갱신한다.
- 클라이언트는 최초 진입 시 이전달, 이번달, 다음달 범위만 요청한다.
- 기존 page/database 전체 재대조는 `updatedAfter` watermark 기반 증분 조회로 낮추고, 전체 snapshot은 복구 경로로만 남긴다.
- 웹 IndexedDB와 Tauri SQLite 캐시는 hard limit 10GB, prune target 9GB로 통일한다.

## 데이터 흐름

1. 사용자가 LC Scheduler를 연다.
2. 클라이언트가 현재 연도 기준의 중심 월을 계산하고 3개월 window를 만든다.
3. 로컬 page cache에서 즉시 투영 가능한 일정은 먼저 표시한다.
4. `listSchedules(workspaceId, from, to, filters)`로 read index를 조회해 window에 필요한 원격 일정을 받는다.
5. page/database reconciliation은 마지막 성공 watermark 이후 변경분만 조회한다.
6. 사용자가 다른 월로 이동하거나 필터를 바꾸면 해당 bucket만 추가 조회한다.
7. 캐시가 10GB를 넘으면 서버에서 재구성 가능한 `.cache.` 키와 media blob을 오래된 항목부터 삭제한다.

## 필터 정책

- 기본 조회는 `workspaceId + startAt` GSI를 사용한다.
- organization/team/project/member 필터는 resolver에서 필터 표현식으로 적용한다.
- GSI 추가는 이번 범위에서 제외한다. 데이터가 더 커져 필터별 read cost가 문제가 되면 별도 GSI를 추가한다.

## 캐시 정책

- 보존 대상: 사용자 원본 데이터, settings, outbox, 현재 workspace state.
- 삭제 대상: 키에 `.cache.`가 포함된 재구성 가능 캐시, media blob cache.
- Tauri `kv_store`는 `updated_at`, `size` 컬럼을 추가해 oldest-first pruning을 지원한다.

## 검증

- range window helper 테스트.
- schedule index projection 및 resolver side effect 테스트.
- client schedule query variable 테스트.
- web storage quota constant/prune 테스트.
- Tauri storage SQL metadata/prune helper 테스트.
- `npm run test:run`, `npm run typecheck`, `cd infra && npm test`, `cd infra && npm run build`.
