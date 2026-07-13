# 배포 프로세스

> 반복 실패 이력: 미커밋 파일 방치, 버전 불일치, CDK 미배포 순서 오류 다수 발생.
> 아래 순서를 건너뛰지 말 것.

## 전체 순서

```
git branch --show-current → develop 확인
  ↓
git status → clean?
  ↓
버전 bump (package.json + tauri.conf.json 동시)
  ↓
infra/ 변경 있음? → CDK deploy → 완료 확인
  ↓
웹/데스크톱 빌드 env 확인 (Vercel env + GitHub Secrets)
  ↓
로컬 테스트 + build 통과
  ↓
git push origin develop
  ↓
dev 빌드에서 재현·검증
  ↓
사용자 명시 승인 후에만 main/live promote, tag, live 배포
```

## STEP 0 — 브랜치·라이브 보호 게이트
```bash
git branch --show-current
# 반드시 develop 에서 작업 시작
```

- `main`은 live/프로덕션 브랜치다. 사용자의 현재 턴 명시 승인 없이 checkout, commit, merge, rebase, tag, push, 배포를 하지 않는다.
- 라이브 빌드 문제라도 수정은 먼저 `develop`에서 진행하고 dev 빌드에서 재현·검증한다.
- dev 검증 없이 `main` 또는 live 환경을 건드리지 않는다.
- `develop`을 거치지 않은 `main` 직접 push는 금지한다.
- `main`이 `develop`보다 앞서 있거나 브랜치 상태가 꼬여 있으면 임의로 맞추지 말고 상태를 보고하고 사용자 확인을 받는다.

## STEP 1 — 미커밋 파일 확인
```bash
git status
# 수정 파일 있으면 먼저 커밋
```

## STEP 2 — 버전 bump
```bash
# package.json + src-tauri/tauri.conf.json 동시 수정
grep '"version"' package.json src-tauri/tauri.conf.json  # 일치 확인
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: 버전 X.Y.Z bump"
```

## STEP 3 — CDK 배포 (infra/ 변경 시만)

**infra 변경은 develop push 시 dev 스택으로 자동 배포된다** (2026-07-13 확인). 수동
`cdk deploy` 를 병행하면 changeset 충돌(`CREATE_IN_PROGRESS`)이 나므로 **자동 배포에
맡기는 것이 기본**. 반영 확인은 Lambda `LastModified` 또는 번들 grep 으로.

**⚠️ dev/live 스택 구분 — `DEPLOY_ENV` 미지정은 live 배포다** (2026-07-12 실제 발생):

```bash
# dev 스택 수동 배포가 꼭 필요할 때만 (자동 배포와 충돌 주의)
cd infra && DEPLOY_ENV=dev npx cdk deploy DevQuicknoteSyncStack

# live 스택 — 사용자 명시 승인 후에만
cd infra && npx cdk deploy QuicknoteSyncStack
```

- `infra/bin/quicknote.ts`: `DEPLOY_ENV=dev` → `Dev*` 스택·`dev-` 테이블. **미지정 = live**.
- `npx cdk deploy QuicknoteSyncStack`(플래그 없음)은 live Lambda/스키마를 갱신한다. dev 검증 목적이었다면 잘못 나간 것.
- 증상: dev 웹에서 백엔드 수정이 반영 안 됨 + live Lambda 만 갱신됨.

CDK 완료 전 프론트 push 하면 AppSync 뮤테이션 실패 → 데이터 손실 위험

**AI 설정(WorkspaceAiConfig)은 워크스페이스별**이다. "키가 사라졌다" 신고가 오면 코드/서버 의심 전에 **현재 워크스페이스가 키를 등록한 워크스페이스인지부터 확인**할 것 (2026-07-12 소동: 다른 워크스페이스 진입이 원인, 데이터 정상).

## STEP 3.5 — 웹/데스크톱 빌드 env 확인

Vite env 는 빌드 시점에 번들에 박힌다. 웹은 Vercel env, 데스크톱 릴리스는 GitHub repo
Secrets(`.github/workflows/build.yml`)를 사용하므로 둘을 따로 확인해야 한다.

```bash
# 웹 production env
tmp=$(mktemp)
vercel env pull "$tmp" --environment=production --yes
grep '^VITE_COLLAB_' "$tmp"
rm -f "$tmp"

# 데스크톱 release build secrets — 값은 못 읽지만 updatedAt 으로 갱신 여부 확인
gh secret list | grep 'VITE_COLLAB'
```

- 협업 ON 릴리스는 `VITE_COLLAB_WS_URL`, `VITE_COLLAB_ENABLED_PAGE_IDS`,
  `VITE_COLLAB_ENABLED_DB_IDS`, `VITE_COLLAB_ROOM_EPOCH` 이 웹·데스크톱 양쪽에서 같아야 한다.
- epoch/WS URL을 바꿨으면 Vercel env만 바꾸지 말고 GitHub Secrets도 같은 값으로 갱신한 뒤 tag를 만든다.
- 데스크톱 앱은 updater의 `latest.json` version 이 설치 버전보다 커야 업데이트를 받는다. 같은 버전으로
  assets만 다시 빌드/업로드하면 이미 그 버전을 받은 사용자는 보통 다시 업데이트되지 않는다.

## STEP 4 — 로컬 검증
```bash
npm run test:run
npm run typecheck
npm run build
```

변경 범위가 작아 전체 테스트 대신 targeted test 를 먼저 돌렸더라도, release/promote 전에는 전체 검증 필요 여부를 사용자에게 명확히 보고한다.

## STEP 5 — develop push 및 dev 빌드 검증
```bash
git push origin develop
```

- develop push 후 dev 빌드에서 문제 재현 경로를 다시 확인한다.
- 라이브 이슈였더라도 dev 빌드에서 먼저 수정 효과를 확인하기 전에는 main/live 로 진행하지 않는다.

## STEP 6 — 사용자 승인 후 live promote/tag
```bash
# dev 빌드 검증 완료 + 사용자 명시 승인 후에만 실행:
# git checkout main
# git merge develop
# git tag v{version}
# git push origin main
# git push origin v{version}
```

## STEP 6.5 — Vercel Production 배포 (main push 후 필수 확인)

`main` push·태그만으로 **Production alias가 갱신되지 않는 경우가 있다.** develop Preview는 Ready인데 live(Production)가 몇 시간 전 커밋에 머물면 이 단계를 수행한다.

```bash
vercel ls --prod          # Production ● Ready 시각·커밋 확인
vercel ls                 # develop Preview vs Production 시각 비교
# Production이 main 최신 커밋보다 오래됐으면:
git checkout main && git pull
vercel deploy --prod --yes
vercel ls --prod          # 새 Production Ready 확인
```

**회귀 징후**: dev에서 확인한 fix(예: 슬래시 `/이모지` 커스텀 탭·이미지 업로드)가 live에 없음 → 대부분 Production 미배포. GitHub `main` CI success ≠ Vercel Production 갱신.

## STEP 7 — dev/live 배포 확인
```bash
vercel ls   # dev 배포 ● Ready 확인
# 에러 시: vercel inspect <url> --logs
```

live 배포 확인은 사용자가 main/live promote 를 명시 승인한 뒤에만 진행한다.

## 실패 시 체인 리액션
CDK 미배포 → 뮤테이션 실패 → 데이터 로컬에만 쌓임 → localStorage 마이그레이션 → **데이터 영구 손실**

## CI 실패: test 단계 heap OOM (회귀 주의)

증상: `npm run test:run` 이 12~16분 후 `JavaScript heap out of memory` 로 실패 → **build/Vercel 배포가 트리거되지 않아 프런트 fix 가 라이브에 반영 안 됨**.

- **진짜 원인은 메모리 부족이 아니라 테스트 mock 무한 루프**다. `mockResolvedValue` 로 매 호출
  동일 `nextToken` 을 반환하면 `fetchApplyWorkspaceRemoteMetaSnapshot` 의 nextToken 자동 루프가
  종료되지 않아 콘솔 로그가 수백만 건 → vitest 콘솔 버퍼가 heap 소진.
- **대응**: `NODE_OPTIONS`/메모리 증설로 해결하려 하지 말 것. **로컬 전체 실행(`npx vitest run`)으로
  먼저 재현** → 로그가 폭주하면 무한 루프 의심. 페이지네이션 mock 은 `mockResolvedValueOnce` 로
  마지막 배치 `nextToken: null` 종료 시퀀스 사용.
- 운영 루프(`workspaceSnapshotBootstrap.ts` nextToken while)에는 토큰 반복 감지 가드가 있음.
- 부가: jsdom 테스트는 `src/__tests__/setup.ts` 의 `fake-indexeddb/auto` 로 `indexedDB is not defined`
  에러 폭주를 제거함.

## 관련 위키
- [version-sync.md](version-sync.md)
- [data-safety.md](data-safety.md)
