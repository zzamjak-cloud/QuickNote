# 배포 프로세스

> 반복 실패 이력: 미커밋 파일 방치, 버전 불일치, CDK 미배포 순서 오류 다수 발생.
> 아래 순서를 건너뛰지 말 것.

## 전체 순서

```
git status → clean?
  ↓
버전 bump (package.json + tauri.conf.json 동시)
  ↓
infra/ 변경 있음? → CDK deploy → 완료 확인
  ↓
git tag v{version}
git push origin main && git push origin v{version}
  ↓
vercel ls → ● Ready 확인
```

## STEP 0 — 미커밋 파일 확인
```bash
git status
# 수정 파일 있으면 먼저 커밋
```

## STEP 1 — 버전 bump
```bash
# package.json + src-tauri/tauri.conf.json 동시 수정
grep '"version"' package.json src-tauri/tauri.conf.json  # 일치 확인
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: 버전 X.Y.Z bump"
```

## STEP 2 — CDK 배포 (infra/ 변경 시만)
```bash
cd infra && npx cdk deploy --all
```
CDK 완료 전 프론트 push 하면 AppSync 뮤테이션 실패 → 데이터 손실 위험

## STEP 3 — 태그 생성 및 push
```bash
git tag v{version}
git push origin main
git push origin v{version}
```

## STEP 4 — Vercel 배포 확인
```bash
vercel ls   # ● Ready 확인
# 에러 시: vercel inspect <url> --logs
```

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
