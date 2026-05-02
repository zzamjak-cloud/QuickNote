# QuickNote

개인용 노션 스타일 메모 앱. v1.0.0은 **웹 에디터 단독** 버전이며, Tauri 데스크톱·AWS 동기화·구글 인증·자동 업데이트는 차기 버전에서 단계적으로 추가된다.

## 기능 (v1.1.1)

페이지/사이드바
- **트리형 페이지** — `parentId` 기반 무한 중첩, 사이드바에서 펼치기/접기
- 페이지별 **이모지 아이콘** (`emoji-picker-react`, 카테고리 탭 + 검색)
- 사이드바 드래그: 같은 부모 내 정렬 + 우측 절반에 떨어뜨리면 자식으로 이동
- 우클릭 메뉴: 하위 페이지 추가, 이름 변경, **다른 페이지로 이동**(picker 모달), 루트로 이동, 삭제
- 페이지 제목 검색(매치된 페이지의 조상까지 펼쳐서 표시)

에디터
- 블록 단위 편집 (TipTap 3, ProseMirror)
- `/` 슬래시 명령 — 본문/제목 1~3/리스트/할 일/코드/인용/구분선/이미지/표/콜아웃/토글/유튜브/페이지 링크/**새 페이지(현재 페이지의 하위로 생성 + 본문 멘션 자동 삽입)**
- 호버 시 **블록 핸들** ⋮⋮ + ➕ — 메뉴(위/아래 이동, 복제, 삭제), 새 블록 추가
- 텍스트 선택 시 **부유 툴바** — 굵게/기울임/취소선/코드/링크/**텍스트 색**/**형광펜**
- `@` 입력으로 **다른 페이지 인라인 멘션** (클릭 시 해당 페이지로 이동)
- 표(리사이즈 가능), 콜아웃(이모지 + 본문), 토글(접기·펼치기), YouTube 임베드
- 이미지 인라인 삽입 (base64, ≤ 5MB)
- 코드 블록 구문 강조 (`lowlight` + `highlight.js`)
- 블록 키보드 이동 (`Cmd/Ctrl + Shift + ↑/↓`)
- 다크 모드
- localStorage 자동 저장 (300ms 디바운스)

## 단축키

| 단축키 | 동작 |
|---|---|
| `Cmd/Ctrl + N` | 새 페이지 |
| `Cmd/Ctrl + K` | 사이드바 검색 포커스 |
| `Cmd/Ctrl + /` | 다크 모드 토글 |
| `Cmd/Ctrl + Shift + ↑/↓` | 현재 블록 위/아래로 이동 |
| `/` | 슬래시 명령 메뉴 |

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
