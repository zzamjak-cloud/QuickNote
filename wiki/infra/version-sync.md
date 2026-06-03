# 버전 동기화

## 세 값이 반드시 일치해야 함

| 파일 | 키 |
|------|----|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| git 태그 | `v{version}` |

GitHub Actions `Publish Release` 워크플로우는 세 값 불일치 시 실패.

## 버전 bump 절차
```bash
# 1. 두 파일 동시 수정
# 2. 확인
grep '"version"' package.json src-tauri/tauri.conf.json
# 3. 커밋
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: 버전 X.Y.Z bump"
# 4. 태그
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

## npm peer dependency 충돌 (Vercel 빌드 실패)
프로젝트 루트 `.npmrc` 유지 필수:
```
legacy-peer-deps=true
```

## TipTap 패키지 주의
모든 `@tiptap/*` 패키지 버전이 **동일**해야 함.
(`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-*` 전부 같은 버전)
