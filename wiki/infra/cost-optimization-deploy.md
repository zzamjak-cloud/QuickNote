# 서버 비용 최적화 — 배포·마이그레이션 런북

코스트 최적화 8개 항목(#1~#9, #5 제외) 적용에 따른 **배포 순서와 데이터 마이그레이션** 절차.
프론트엔드(#3·#4·#8·#9 클라이언트)는 일반 프론트 배포로 끝나지만, 아래 항목은 **AWS 재배포 + 백필**이 필요하다.

> 원칙: 신규 GSI/TTL 은 배포 시 비파괴적이지만(in-place), **기존 데이터는 자동으로 채워지지 않는** 경우가 있어 백필이 필요하다. 백필 전에 안전망(trash-purge 등)을 먼저 제거하지 말 것.

---

## 적용 항목 요약

| # | 내용 | 배포 | 백필 |
|---|------|------|------|
| #1 | Pages 테이블 TTL(`purgeAt`)로 휴지통 자동삭제 → trash-purge 대체 | CDK + v5-resolvers | **필요** (기존 휴지통 페이지) |
| #2 | image-gc: ImageAsset `byStatus` GSI Query + PENDING은 expireAt TTL 위임 | CDK + image-gc | 자동(GSI 백필) |
| #6 | team/org/member 멤버조회 N+1 → BatchGet | v5-resolvers | 불필요 |
| #7 | team/org 이름 중복체크 Scan → `byName` GSI(`nameLower`) | CDK + v5-resolvers | **필요** (기존 team/org) |
| #9 | customIcon 구독 tombstone(`deletedAt`)으로 전체 refetch 제거 | schema + v5-resolvers + 프론트 | 불필요 |
| #3 | 워크스페이스 재페치 증분 동기화(updatedAfter 워터마크) | 프론트만 | 불필요 |
| #4 | 즐겨찾기 폴백을 현재 워크스페이스 우선 | 프론트만 | 불필요 |
| #8 | LC 스케줄러 구독을 스케줄러 오픈 시에만 유지 | 프론트만 | 불필요 |

---

## 배포 순서

### 1) 백엔드/인프라 먼저 배포
```
cd infra
npm run build         # tsc -p . (타입체크)
npm test              # vitest (핸들러 회귀)
npx cdk diff          # 변경 검토 — 신규 GSI 3개(byStatus, teams.byName, orgs.byName) + Pages TTL 확인
npm run deploy        # cdk deploy --all
```
- 신규 GSI(`ImageAsset.byStatus`, `Teams.byName`, `Organizations.byName`)는 생성 시 DynamoDB 가 **자동 백필**한다(테이블 크기에 따라 수 분). 백필 완료 전까지 해당 Query 는 일부 결과가 비어 보일 수 있으니, GSI ACTIVE 상태를 콘솔에서 확인 후 다음 단계로.
- Pages 테이블 TTL(`purgeAt`)은 in-place 활성화(UpdateTimeToLive) — 테이블 재생성 없음.

### 2) 프론트엔드 배포
- #9 는 클라이언트가 `deletedAt` 필드를 읽으므로 **백엔드(schema) 배포 후** 프론트를 배포해야 한다. (구 클라이언트는 `deletedAt` 을 무시하므로 역방향 호환은 됨 — 다만 구 클라이언트는 전체 refetch 경로를 계속 사용.)
- #3 워터마크 스토어(`quicknote.sync.watermark.v1`)는 신규 persist 키라 마이그레이션 불필요.

---

## 마이그레이션(백필)

### A. #1 — 기존 휴지통 페이지 `purgeAt` 백필
새 코드는 **앞으로의** soft delete 에만 `purgeAt` 을 기록한다. 이미 휴지통에 있는(=`deletedAt` 존재, `purgeAt` 없음) 페이지는 TTL 대상이 되지 않으므로 1회 백필한다.

스크립트: `infra/scripts/backfill-purge-at.ts` (기본 DRY-RUN, `--apply` 로만 기록, 멱등).
```
cd infra
AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-purge-at.ts          # 미리보기(대상 건수만)
AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-purge-at.ts --apply  # 실제 기록
```
- 대상: `attribute_exists(deletedAt) AND attribute_not_exists(purgeAt)`.
- `purgeAt = floor((Date.parse(deletedAt) + 30일) / 1000)` (epoch **seconds** — 스크립트가 보장).
- 테이블명 오버라이드: `PAGES_TABLE_NAME`(기본 `quicknote-page`).

백필 완료 후:
- `infra/lib/sync-stack.ts` 의 `TrashPurgeSchedule`(EventBridge Rule)을 제거하고 재배포해 **일일 풀스캔 비용을 제거**한다. (Lambda 자체는 남겨도 무방하나 스케줄만 제거하면 됨.)
- TTL 삭제는 최대 48시간 지연될 수 있다(정상). 즉시성이 필요하면 스케줄을 한동안 더 유지.

### B. #7 — 기존 team/organization `nameLower` 백필
새 코드는 create/update 시에만 `nameLower` 를 기록한다. 기존 team/org 에는 `nameLower` 가 없어 `byName` GSI 에 색인되지 않으므로, 그 이름으로의 중복체크가 통과해버린다.

스크립트: `infra/scripts/backfill-name-lower.ts` (teams + organizations 모두 처리, 기본 DRY-RUN, 멱등).
```
cd infra
AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-name-lower.ts          # 미리보기
AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-name-lower.ts --apply  # 실제 기록
```
- 각 row 에 `nameLower = name.trim().toLowerCase()` 를 set(이미 동일하면 건너뜀).
- 테이블명 오버라이드: `TEAMS_TABLE_NAME`, `ORGANIZATIONS_TABLE_NAME`.
- ⚠️ GSI 가 ACTIVE 된 뒤 실행해야 백필분이 즉시 색인된다.

### C. #2 — image-gc
- 별도 백필 없음. GSI 자동 백필만 기다리면 된다.
- PENDING 정리는 ImageAsset 의 기존 `expireAt` TTL 에 위임된다(이미 image-presign 이 expireAt 을 기록). PENDING 의 잔여 S3 객체는 GC 의 untracked-S3 sweep(2일 grace)이 회수.

### D. #9 — customIcon
- 데이터 마이그레이션 없음. `deletedAt` 은 deleteCustomIcon 응답(=구독 페이로드)에만 실린다.

---

## 검증 체크리스트(배포 후)
- [ ] 페이지를 휴지통으로 보낸 뒤 DynamoDB 콘솔에서 해당 row 에 `purgeAt`(미래 epoch초)가 있는지. 복원 시 `purgeAt` 이 사라지는지.
- [ ] image-gc 수동 invoke → 반환 JSON 에 `readyOrphans`/`untrackedS3` 만 있고 에러 없는지. `byStatus` GSI Query 가 동작하는지.
- [ ] 같은 이름의 팀/조직 생성 시 중복 거부되는지(백필 후).
- [ ] 다른 클라이언트에서 커스텀 아이콘 추가/삭제 시, 내 화면이 **전체 refetch 없이** 추가/제거 반영되는지.
- [ ] 오프라인→온라인 복귀 시 네트워크 탭에서 listPages 가 `updatedAfter` 로 호출되는지(증분).
- [ ] 스케줄러 팝업을 닫은 상태에서 LC 스케줄러 구독(WebSocket)이 유지되지 않는지.

---

## 비고: #5(GSI 프로젝션 ALL→INCLUDE)는 적용하지 않음
`listPages`/`listDatabases` 가 `byWorkspaceAndUpdatedAt` GSI 에서 `doc` 등 **본문 전체를 직접 읽어 오프라인 풀 하이드레이션**을 수행하므로, ALL 프로젝션은 의도된 load-bearing 설계다. INCLUDE 로 줄이면 목록 하이드레이션이 깨지고 GSI 재생성(쿼리 중단+백필)도 유발하므로 **권장하지 않음**.
