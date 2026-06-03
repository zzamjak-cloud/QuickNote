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

## 관련 위키
- [version-sync.md](version-sync.md)
- [data-safety.md](data-safety.md)
