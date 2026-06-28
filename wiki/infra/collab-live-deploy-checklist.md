# 실시간 협업 라이브 배포 체크리스트

실시간 협업(Phase 1~4)을 `main`/live 로 승격할 때의 안전 점검. **순서를 지키지 않으면 라이브에서 페이지가 안 뜨거나 데이터가 깨진다.**
구조·바인딩 3원칙·진단 가이드는 [`collab/overview.md`](../collab/overview.md) 참고.

> 현황: 2026-06-12 라이브 전체 오픈(v5.4.36, 페이지 `*` + DB `*`, epoch v3).
> 2026-06-13 데스크톱 빌드 협업 합류 + epoch v3→v4(데스크톱 협업 OFF 비대칭 정리, §1.7). 코드 기본값 v4.
> 2026-06-15 WS 청킹 + epoch v4→v5. Vercel env 와 GH repo Secrets 를 함께 v5 로 맞춘다.

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

### ⛔ Vercel env 는 반드시 일반(Plain) 타입으로 등록 (2026-06-11 사고)

협업 env 를 **Sensitive 타입**으로 등록하면 값을 다시 읽을 수 없다 — 대시보드 편집 화면이
빈 칸으로 보이고 `vercel env pull` 도 빈 값을 돌려주지만 **실제 값은 살아있다.**
"비우고 저장"해도 값이 유지되어, env 를 껐다고 믿은 상태로 협업 ON 빌드가 계속 나가는
사고가 났다(빈 칸 확인 → save → 재빌드 반복에도 wss inline 잔존). 진단도 오염된다
(`vercel env pull` 이 빈 값을 보여 "OFF 확인"이라는 가짜 신호를 줌).

- 협업 env 3종은 **Plain 타입으로만** 등록한다. 끌 때는 값 비우기 대신 **행 삭제**(`vercel env rm`)가 확실하다.
- env 변경 후 재배포는 **빈 커밋이 아닌 실코드 변경**으로 트리거한다(빈 커밋은 Vercel 이 구 번들을 재사용할 수 있음).
- 빌드가 실제로 OFF 인지 최종 확인: 배포 번들에서 `wss://...execute-api` inline 여부를 검사한다(공개 도메인이면 fetch+grep).

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

## 1.5 ⛔ 룸 epoch — 협업을 껐다 다시 켤 때 반드시 올린다 (2026-06-11 감사)

룸 Y 상태는 서버(`{env}quicknote-rt-ydoc`/`-ydoc-updates`, TTL 없음)와 각 브라우저
IndexedDB(`qn-collab:*`) 양쪽에 영구 보존된다. 협업이 꺼진 기간에 일반 동기화로 수정된
페이지·DB 는 룸 상태에 반영되지 않으므로, **재활성화 시 stale 룸이 그대로 살아나면 빈-가드를
통과해 최신 본문·행 순서를 과거로 되돌린다.** (서버 테이블만 비워도 브라우저 잔재가 sv-reply
로 룸을 재오염시키므로 불충분.)

방어 체계:
- 룸 키와 IndexedDB 키에 **epoch 솔트**(`collabRoomEpoch()`, 코드 기본값 현재 `v4`)가 들어간다 —
  `v4:<pageId>` / `db:v4:<dbId>` / `qn-collab:v4:<pageId>`. 서버는 `parseRoom`(infra/lambda/realtime/room.ts)
  으로 솔트를 벗겨 인가·시드하고, 저장 키는 풀 문자열이라 세대별 격리된다.
- **운영 규칙: 협업을 OFF→ON 하거나 권위 비대칭을 정리할 때마다 `VITE_COLLAB_ROOM_EPOCH` 를 올린다**
  (v2→v3→v4→…). **웹(Vercel)·데스크톱(GH secret) 을 반드시 같은 값으로** — 한쪽만 올리면 서로 다른
  룸에 붙어 동기화가 끊긴다.
  과거 세대 룸·IDB 잔재가 전부 무력화된다.
- materialize 는 **서버 sync 완료 후에만** 동작한다(useCollabSession·useDatabaseCollabSession 의
  serverSynced 게이트) — IndexedDB 단독 stale 상태가 store 를 덮지 못한다.
- 본문 미로드(pageContentMissing) 중에는 협업 편집이 차단된다(Editor.tsx) — 시드 전 입력이
  본문을 대체하는 레이스 봉합.
- 잔여 위험: 라이브 점진 롤아웃 중 구버전 번들(협업 OFF) 사용자의 일반 편집은 룸에 반영되지
  않는다 → **단계적 오픈 + 짧은 롤아웃 창** 권장 (소수 페이지 → 팀 워크스페이스 → `*`).

## 1.6 ⛔ 에디터 바인딩 3원칙 (2026-06-12 라이브 사고 재설계)

라이브 단일 페이지 테스트에서 ① 전 페이지 빈 화면(빈 문단이 Y 에 선주입돼 시드 영구 차단)
② 두 클라 한 줄 불일치(서로 다른 로컬 본문으로 결정적 시드 → 같은 clientID 에 다른 내용
→ CRDT 분기) ③ view 미마운트 접근 크래시가 루트 경계로 전파돼 사이드바까지 소실 —
세 사고가 연달아 났다. 재설계 원칙(Editor.tsx):

1. **시드 소스는 서버 본문만** — `fetchPageById` 결과로만 시드(모든 클라 byte-동일).
   피어가 이미 시드한 doc(비어있지 않음)은 시드 생략. 서버 본문이 placeholder 면
   "진짜 빈 페이지"로 확정하고 시드 없이 바인딩. **로컬 store 본문으로 시드 금지.**
2. **시드 완료 후에만 바인딩** — `collabBoundDoc` 게이트. ySyncPlugin 이 빈 fragment 에
   붙으면 빈 문단을 주입해 시드를 영구 차단한다.
3. **view 마운트 후에만 오버레이** — `editorViewReady` 게이트(BlockHandles·BubbleToolbar 등)
   + `EditorErrorBoundary` 로 에디터 오류를 에디터 영역에 격리(사이드바 보호).

검증 시나리오(릴리스 전 필수): 공유 워크스페이스 콘텐츠 페이지 시크릿 콜드로드 /
두 브라우저 동시 첫 진입(시드 race) / 협업 중 연속 새로고침 4~5회 / 동시 편집 후
양쪽 본문 완전 일치 / 신규 빈 페이지 즉시 입력 / **다른 계정**(인가·presence·view-only).

## 1.7 ⛔ 데스크톱(Tauri) 빌드도 반드시 협업 env 를 주입한다 (2026-06-13 사고)

증상: 데스크톱 앱에서 본문을 수정하면 웹앱에서 "새 내용이 잠깐 보였다가 옛 내용으로 덮어써짐".
desktop↔web 동기화가 끊긴다.

근본 원인 — **권위 비대칭**: 데스크톱 빌드(`.env`/`.env.development`/CI `build.yml`)에
`VITE_COLLAB_WS_URL` 이 없어 **데스크톱은 협업 OFF**였다. 협업 OFF 데스크톱 편집은 비협업
autosave 로 **서버 `page.doc`(REST)만** 갱신하고 Y 룸엔 안 들어간다. 반면 라이브 웹은 협업 ON
(`*`, epoch)이라 본문 권위가 **Y 룸**이다. 서버는 페이지 룸을 시드하지 않으므로(`sync.ts`,
`db:` 룸만 시드), 웹은 데스크톱이 못 건드리는 **stale Y 룸**을 권위로 채택 → 옛 내용으로 덮어쓴다.

규칙:
- **협업이 켜진 동안에는 데스크톱·웹이 동일한 `VITE_COLLAB_WS_URL`·allowlist·epoch 을 써야 한다.**
  하나라도 협업 OFF 면 그 클라이언트는 REST `page.doc` 권위로 갈려 동기화가 끊긴다.
- 데스크톱 릴리스 시크릿(GH repo Secrets, `build.yml` 가 tauri-action 에 주입):
  `VITE_COLLAB_WS_URL`(웹과 동일 값), `VITE_COLLAB_ENABLED_PAGE_IDS=*`,
  `VITE_COLLAB_ENABLED_DB_IDS=*`, `VITE_COLLAB_ROOM_EPOCH`(웹과 동일).
  `build.yml` 의 "Verify Vite secrets" 가 `VITE_COLLAB_WS_URL` 누락 시 빌드를 실패시킨다.
- live env 변경 후에는 **GitHub Secrets updatedAt 도 반드시 확인**한다. Vercel env 만 v5 로 올리고
  GH Secrets 가 v4 로 남으면 웹과 데스크톱이 서로 다른 룸에 붙어 콘솔 에러 없이 동기화가 끊긴다.
  ```bash
  tmp=$(mktemp)
  vercel env pull "$tmp" --environment=production --yes
  gh secret set VITE_COLLAB_WS_URL --body "$(awk -F= '$1=="VITE_COLLAB_WS_URL"{v=$2; gsub(/^"|"$/, "", v); print v}' "$tmp")"
  gh secret set VITE_COLLAB_ENABLED_PAGE_IDS --body "$(awk -F= '$1=="VITE_COLLAB_ENABLED_PAGE_IDS"{v=$2; gsub(/^"|"$/, "", v); print v}' "$tmp")"
  gh secret set VITE_COLLAB_ENABLED_DB_IDS --body "$(awk -F= '$1=="VITE_COLLAB_ENABLED_DB_IDS"{v=$2; gsub(/^"|"$/, "", v); print v}' "$tmp")"
  gh secret set VITE_COLLAB_ROOM_EPOCH --body "$(awk -F= '$1=="VITE_COLLAB_ROOM_EPOCH"{v=$2; gsub(/^"|"$/, "", v); print v}' "$tmp")"
  rm -f "$tmp"
  gh secret list | grep 'VITE_COLLAB'
  ```
- **전환 시 epoch 을 올려 stale 룸을 격리**(아래 §1.5). 빈 새 세대 룸이 서버 `page.doc`(데스크톱
  협업 OFF 기간에 REST 로 갱신된 최신 본문 포함)으로 재시드되어, 가려졌던 데스크톱 편집분이 복구된다.
- **순서**: 웹 epoch 전환과 데스크톱 새 빌드 배포를 가깝게. 구버전(협업 OFF) 데스크톱이 남아 있는
  동안에는 그 클라이언트의 편집이 여전히 웹에 반영되지 않는다.
- 이미 같은 버전을 받은 데스크톱 앱은 같은 version 의 재빌드 asset 을 다시 받는다고 가정하지 않는다.
  env/secrets 보정 후에는 patch version 을 올려 새 tag/release 를 만들고 `latest.json` version 을 증가시킨다.

보조 방어(코드, 2026-06-13):
- `pageCollabRegistry` — 협업 세션이 열린 페이지는 `applyRemotePageToStore`(storeApply)가 원격
  `page.doc` echo 로 store.doc 를 덮지 않고 본문을 로컬(Y/materialize) 값으로 보존(`preserveCollabDoc`).
  세션 비활성·초기 하이드레이션은 정상 적용.
- `QnWsProvider` sv-reply 는 **연결당 첫 sync 에서만** 전송 — 매 25초 ping-sync 마다 stale IDB delta 를
  서버 룸에 재append 하던 오염(H3)을 차단. 이후 편집은 `update` 메시지로 전송되므로 누락 없음.

## 1.8 ⛔ PWA Service Worker ↔ epoch 정합 (2026-06-28, PWA Phase 3)

웹에 PWA(Service Worker precache)가 도입되면서 §1.5/§1.7 의 "stale 클라이언트가 옛 epoch
룸에 붙는" 위험이 **데스크톱 구버전뿐 아니라 웹 stale SW 에서도** 발생한다.

근본 원인 — **epoch 은 빌드타임에 박힌다**: `VITE_COLLAB_ROOM_EPOCH` 는 번들에 인라인된다.
SW 가 옛 번들을 precache 에서 서빙하면 그 사용자는 **옛 epoch 룸**에 붙는다. epoch bump +
새 번들을 배포해도, 업데이트 프롬프트를 dismiss 한 사용자의 SW 는 옛 셸을 계속 제공한다
(§1.7 의 web/desktop epoch 불일치와 같은 분기 — 원인만 stale SW).

방어 체계(PWA Phase 3 PR1 워크스트림 A 로 구현됨):
- **셸 신선도 상한**: `swController.initPwa()` 가 60분 주기 + 포커스 복귀 시 `reg.update()` →
  새 SW 감지 시 업데이트 배너. 청크 404 가 새로고침 후에도 반복되면(`chunkReload.ts`) SW 강제
  교체(`forcePwaUpdate`). → stale 셸이 무한정 유지되지 않는다(상한 ≈ 업데이트 간격).
- 그래도 **롤아웃 창 동안에는** 옛 SW 사용자가 옛 epoch 룸에 남는다. §1.5/§1.7 과 동일하게
  **단계적 오픈 + 짧은 롤아웃 창**으로 완화한다.

운영 규칙:
- **epoch bump 와 SW precache 교체(=새 프론트 배포)는 항상 동시에** 나간다. 새 프론트 배포가
  곧 새 SW precache 이므로, epoch env 변경 → 같은 배포에서 프론트 재빌드(빈 커밋 금지, §0의
  "실코드 변경으로 트리거" 규칙과 동일).
- 배포 후 검증: 직전에 열어둔 웹 탭에서 (a) 업데이트 배너가 뜨고 (b) 새로고침 후 새 epoch
  룸으로 수렴하는지 확인. DevTools → Application → Service Workers 에서 새 SW 활성 확인.
- Tauri 데스크톱은 SW 미사용(§PWA 는 웹 전용) → 데스크톱은 종전대로 §1.7 규칙(빌드/secret/tag).

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
5) (협업 켤 때만) 라이브 Vercel env(VITE_COLLAB_*) 설정
6) (협업 켤 때만) GH repo Secrets(VITE_COLLAB_*) 를 Vercel env 와 동일 값으로 설정
7) develop → main merge
8) 프론트 라이브 빌드/배포 (Vercel main) + 데스크톱 tag/release
9) vercel ls 로 Ready 확인 + GitHub Release latest.json 확인 + 라이브 페이지/데스크톱 협업 동작 확인
```

- 협업을 **아직 안 켤 거면 3·7·8 만** 하면 된다(§9.1 스키마 + 프론트). 4·5·6·9의 협업 검증은 생략, 협업은 휴면.

---

## 5. 알려진 한계 / 주의

- **DB 협업(Phase 4) = 구조만**(columns·presets·panelState·rowPageOrder). 셀 값·행 추가/삭제·title 메타는 현행 LWW. 템플릿(automation) 변경은 협업 ON DB 에서 즉시 영속 안 됨(slice A 비목표) → 협업 ON DB 에서 템플릿 자동화 설정 변경은 피하거나 후속 보완 전까지 보류.
- 같은 DB 를 한 화면 여러 블록에 띄우면 협업 세션이 databaseId 로 중복 등록될 수 있음(마지막 등록 우선) — 단일 블록 사용 권장.
- 버전 히스토리는 세션 머지 + 서버 스냅샷 모델([history/overview.md](../history/overview.md) 참고).
  Y.Snapshot/룸 로그 기반은 epoch bump 시 증발하므로 채택하지 않았다.

## 관련 위키
- [deploy.md](deploy.md) — 일반 배포 순서·브랜치 보호
- [version-sync.md](version-sync.md)
