# 버전 동기화

## 세 값이 반드시 일치해야 함

| 파일 | 키 |
|------|----|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| git 태그 | `v{version}` |

GitHub Actions `Publish Release` 워크플로우는 세 값 불일치 시 실패.

## 브랜치 보호

- 버전 bump 와 release 준비도 기본 작업 브랜치는 `develop`이다.
- `main` push, tag push, live 배포는 dev 빌드 검증 완료 후 사용자 명시 승인이 있을 때만 진행한다.
- 라이브 이슈 수정이라도 `develop` → dev 빌드 검증 → 승인 → `main`/live promote 순서를 건너뛰지 않는다.

## 버전 bump 절차

수동 2중 수정은 불일치가 잦아 **`npm run bump` 스크립트로 동기화**한다
(`scripts/bump-version.mjs`, `228bbfcd`). package.json + tauri.conf.json 의 `version` 을 한 번에 맞춘다.

```bash
# 1. 버전 동기화 (택1)
npm run bump 5.4.53   # 지정 버전
npm run bump patch    # patch +1
npm run bump minor    # minor +1, patch=0
npm run bump major    # major +1, minor=patch=0
# 2. 확인
grep '"version"' package.json src-tauri/tauri.conf.json
# 3. 커밋
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: 버전 X.Y.Z bump"
# 4. develop push 후 dev 빌드 검증
git push origin develop
# 5. dev 검증 완료 + 사용자 명시 승인 후에만 태그/main push
# git checkout main
# git merge develop
# git tag vX.Y.Z
# git push origin main
# git push origin vX.Y.Z
```

## npm peer dependency 충돌 (Vercel 빌드 실패)
프로젝트 루트 `.npmrc` 유지 필수:
```
legacy-peer-deps=true
```

## TipTap 패키지 주의
모든 `@tiptap/*` 패키지 버전이 **동일**해야 함.
(`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-*` 전부 같은 버전)
