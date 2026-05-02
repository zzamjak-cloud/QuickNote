# QuickNote

개인용 노션 스타일 메모 앱. v1.0.0은 **웹 에디터 단독** 버전이며, Tauri 데스크톱·AWS 동기화·구글 인증·자동 업데이트는 차기 버전에서 단계적으로 추가된다.

## 기능 (v1.0.0)

- 페이지 생성·삭제·이름 변경, 사이드바 드래그 정렬
- 블록 단위 편집 (TipTap 3, ProseMirror 기반)
- `/` 슬래시 명령으로 블록 타입 전환 (제목, 목록, 할 일, 코드, 인용, 구분선, 이미지)
- 이미지 인라인 삽입 (base64)
- 코드 블록 구문 강조 (`lowlight` + `highlight.js`)
- 블록 드래그 앤 드롭 정렬
- 다크 모드, 페이지 검색
- localStorage 자동 저장 (새로고침 시 유지)

## 기술 스택

React 19 · Vite 7 · TypeScript 5.9 (strict) · Tailwind CSS 3 · TipTap 3 · Zustand 4 · @dnd-kit · lucide-react · Vitest 3

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run test:run
npm run build
```

## 데이터 저장 위치

브라우저 `localStorage`에 다음 키로 저장된다.

| 키 | 내용 |
|---|---|
| `quicknote.pageStore.v1` | 페이지 본문/메타 (Zustand persist) |
| `quicknote.settings.v1` | 다크 모드 등 설정 |
| `quicknote.schemaVersion` | 스키마 버전 (마이그레이션 대비) |

## 로드맵

- v1.0.0 — 웹 에디터 MVP (현 버전)
- v2.0.0 — Tauri 데스크톱 이식, SQLite 로컬 저장
- v3.0.0 — AWS Cognito + Google OAuth + 화이트리스트 인증
- v4.0.0 — Lambda + DynamoDB 동기화, S3 이미지 업로드
- v5.0.0 — 실시간 협업(AppSync), 자동 업데이트(GitHub Actions)

## 라이선스

MIT
