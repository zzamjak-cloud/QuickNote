# 실시간 협업 라이브 배포 체크리스트

실시간 협업(Phase 1~4)을 `main`/live 로 승격할 때의 안전 점검. **순서를 지키지 않으면 라이브에서 페이지가 안 뜨거나 데이터가 깨진다.**

> 전제: 모든 협업 코드는 현재 `develop` 에만 있고 라이브엔 없다. 승격은 dev 검증 + 사용자 명시 승인 후에만. 일반 배포 순서는 [deploy.md](deploy.md) 참고(CDK 먼저, 프론트 나중).

---

## 0. 핵심 원칙 — 협업은 기본 OFF

협업은 feature flag 로 게이팅된다. **라이브 Vercel 에 아래 env 를 설정하지 않으면 협업은 완전 휴면**이고, 앱은 협업 도입 전과 동일하게 동작한다.

| env (Vercel) | 효과 |
|--------------|------|
| `VITE_COLLAB_WS_URL` | 비어 있으면 협업 전체 OFF(페이지·DB 모두). |
| `VITE_COLLAB_ENABLED_PAGE_IDS` | 협업 ON 페이지 allowlist. `*` = 전체(**주의**, 아래 §2). |
| `VITE_COLLAB_ENABLED_DB_IDS` | 협업 ON 데이터베이스 allowlist(Phase 4). |

→ 협업을 아직 켜지 않을 거면 위 3개를 **모두 빈 값**으로 두면 라이브 안전.

---

## 1. ⛔ §9.1 스키마 선행 배포 (프론트보다 먼저) — 필수

Phase 1(§9.1)에서 클라이언트 `PAGE_FIELDS`/`PAGE_META_FIELDS` 에 **`lastEditedByMemberId`·`lastEditedByName`** 를 추가했다(`src/lib/sync/queries/page.ts`). 이 필드는 `ListPages`/`GetPage`/`ListDatabaseRows`/`onPageChanged` 등 **핵심 쿼리 전부**에 포함된다.

- **라이브 AppSync 스키마에 이 필드가 없는 상태에서 현재 프론트를 라이브에 올리면**, GraphQL 이 "정의되지 않은 필드" 검증 오류로 **쿼리 전체를 거부 → 라이브 페이지가 아예 안 뜬다.**
- **반드시 라이브 `QuicknoteSyncStack`(스키마 + `upsertPage` 리졸버 §9.1 스탬프)을 프론트 배포보다 먼저 배포**한다.
  - `infra/lib/sync/schema.graphql`: `type Page` 에 두 필드.
  - `infra/lambda/v5-resolvers/handlers/pageDatabase.ts`: `upsertPage` 가 caller 로 스탬프.
- 협업 OFF 여부와 무관하게 이 스키마 변경은 라이브에 필요하다(클라가 항상 그 필드를 select 하므로).

배포: `cd infra && npx cdk deploy QuicknoteSyncStack` (live = DEPLOY_ENV 미지정). diff 에서 `AWS::AppSync::GraphQLSchema ... may be replaced` 는 스키마 in-place 갱신(데이터 영향 없음).

---

## 2. ⛔ 협업을 켤 거면 — 페이지/DB 시드 확인

- **`VITE_COLLAB_ENABLED_PAGE_IDS=*` 같은 광범위 활성화 금지(검증 전).** 기존 콘텐츠 페이지가 협업 ON 되면 본문 권위가 Y.Doc 으로 바뀐다.
- 기존 본문 → Y.Doc **시드**가 동작해야 빈 화면이 안 난다. (시드 미구현 시 빈 화면 — 과거 dev 사고.)
  - 페이지 시드: `seedCollabDocIfEmpty`(`src/lib/collab/yjsDoc.ts`) — 서버 sync 완료 + 콘텐츠 로드 후 Y.Doc 이 비어 있으면 결정적 시드(동시 시드 중복 없음). `Editor.tsx` 가 호출. (커밋 `bc0ab6a`)
  - DB 구조 시드: 서버 `dbSeed.ts` 가 첫 진입 시 Database 항목에서 Y.Doc 시드.
- **롤아웃은 특정 page/DB id 로 좁게 시작** → dev 에서 2탭 수렴·빈화면 없음 확인 → 점진 확대.

---

## 3. 협업 백엔드 스택 (협업 켤 때만)

협업을 라이브에서 켜려면 `QuicknoteRealtimeCollabStack`(WS API + 연결/YDoc 테이블 + Lambda)을 **live 에 배포**해야 한다. 현재 라이브엔 없다(Dev 만 존재).

- `cd infra && npx cdk deploy QuicknoteRealtimeCollabStack`.
- 배포 후 `CollabWsUrl` 출력을 라이브 Vercel `VITE_COLLAB_WS_URL` 에 설정.
- `$connect` 인가는 PAGE_TABLE/DATABASE_TABLE + 워크스페이스 멤버십(Phase 4) 사용 → connectFn env(`DATABASE_TABLE` 등)·IAM 이 스택에 포함돼 있어야 함(이미 코드에 반영).

---

## 4. 승격 순서 (요약)

```
1) dev 전체 검증(2탭 수렴·빈화면 없음·프레즌스·오프라인) 완료
2) 사용자 명시 승인
3) (live) cd infra && npx cdk deploy QuicknoteSyncStack         # §9.1 스키마 선행
4) (협업 켤 때만) npx cdk deploy QuicknoteRealtimeCollabStack
5) develop → main merge
6) 프론트 라이브 빌드/배포 (Vercel main)
7) (협업 켤 때만) 라이브 Vercel env(VITE_COLLAB_*) 설정 → 좁은 allowlist 로 시작
8) vercel ls 로 Ready 확인 + 라이브 페이지 로드/협업 동작 확인
```

- 협업을 **아직 안 켤 거면 3·5·6 만** 하면 된다(§9.1 스키마 + 프론트). 4·7 생략, 협업은 휴면.

---

## 5. 알려진 한계 / 주의

- **DB 협업(Phase 4) = 구조만**(columns·presets·panelState·rowPageOrder). 셀 값·행 추가/삭제·title 메타는 현행 LWW. 템플릿(automation) 변경은 협업 ON DB 에서 즉시 영속 안 됨(slice A 비목표) → 협업 ON DB 에서 템플릿 자동화 설정 변경은 피하거나 후속 보완 전까지 보류.
- 같은 DB 를 한 화면 여러 블록에 띄우면 협업 세션이 databaseId 로 중복 등록될 수 있음(마지막 등록 우선) — 단일 블록 사용 권장.
- 버전 히스토리는 현행 diff/patch 유지(Phase 5 에서 Yjs 스냅샷 예정).

## 관련 위키
- [deploy.md](deploy.md) — 일반 배포 순서·브랜치 보호
- [version-sync.md](version-sync.md)
