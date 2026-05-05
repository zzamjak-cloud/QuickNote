# QuickNote

개인용 노션 스타일 메모 앱.
**릴리스 버전 번호는 루트 `package.json`의 `version`과 동일하게 관리합니다.**
세부 변경 이력은 `CHANGELOG.md`를 참고한다.

## 기능

### 페이지·사이드바

- **트리형 페이지** — `parentId` 기반 무한 중첩, 사이드바 펼치기/접기
- 페이지별 **이모지 아이콘** (카테고리 탭 + 검색)
- 사이드바 드래그: 같은 부모 내 정렬 + 우측에 놓으면 자식으로 이동
- 우클릭 메뉴: 하위 페이지 추가, 이름 변경, 다른 페이지로 이동, 루트로 이동, 삭제
- 페이지 제목 검색 (매치 페이지의 조상까지 자동 펼침)

### 에디터

- 블록 단위 편집 (TipTap 3 / ProseMirror)
- `/` 슬래시 명령 — 본문·제목 1~3·리스트·할 일·코드·인용·구분선·이미지·표·콜아웃·토글·YouTube·페이지 링크·새 페이지 생성
- 호버 시 **블록 핸들** ⋮⋮ + ➕ — 이동·복제·삭제·새 블록 추가
- 텍스트 선택 시 **부유 툴바** — 굵게·기울임·취소선·코드·링크·텍스트 색·형광펜
- `@` 입력으로 **페이지 인라인 멘션** (클릭 시 해당 페이지로 이동)
- **다단 레이아웃** — 드래그로 컬럼 너비 조절
- 표 (컬럼 리사이즈), 콜아웃, 토글, YouTube 임베드
- 이미지 인라인 삽입 (base64, ≤ 5 MB) · 리사이즈 · 정렬
- 코드 블록 구문 강조 (`lowlight` + `highlight.js`)
- 블록 키보드 이동 (`Cmd/Ctrl + Shift + ↑/↓`)
- **박스 다중 선택** — 마우스 드래그로 블록 범위 선택·이동·삭제
- 다크 모드

### 데이터베이스

슬래시 메뉴의 `/데이터베이스` 또는 `/database`로 삽입.

| 뷰 | 설명 |
|---|---|
| **테이블** | 행 × 열 스프레드시트 |
| **갤러리** | 카드 그리드 |
| **칸반** | Select 열 기준 보드 |
| **타임라인** | Date 열 기준 Gantt |

- 셀 타입: Text · Number · Select · Date · Link · Checkbox
- 필터링, 정렬, 열 표시/숨기기
- 뷰 모드(표·갤러리·칸반·타임라인) + 검색/정렬/필터/속성 툴바를 한 줄로 통합 (좌: 모드, 우: 부가 기능)
- 테이블 행 체크박스 선택 후 하단 `N개 선택` 메뉴에서 일괄 삭제(확인 팝업 포함)
- 테이블 컬럼 리사이즈: 가이드 라인 표시 + 핸들 더블클릭 자동 맞춤(가장 긴 값 기준)
- 행을 **페이지로 열기** (본문 편집 + 속성 패널)
- **사이드 피크** — 행 페이지를 오른쪽 슬라이드 모달로 빠르게 열기
- 헤더 `+` 버튼으로 열 추가 / grip 핸들로 열 순서 변경

### 단축키

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

Node.js **20 LTS** 권장 (`.nvmrc` 참고).

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run test:run
npm run build
```

### 데스크톱 (v2.0.0+, Tauri)

Rust stable 필요 (`rustup`으로 설치). 첫 실행 시 로컬 SQLite로 데이터를 마이그레이션한다.

```bash
npm run tauri:dev    # 개발용 데스크톱 창
npm run tauri:build  # 배포용 .dmg / .exe 생성
```

## 데이터 저장

| 환경 | 저장소 |
|---|---|
| 웹 | 브라우저 `localStorage` |
| 데스크톱 (v2+) | 로컬 SQLite (`~/.local/share/quicknote/quicknote.db`) |

## 로드맵

- **v1.0.0** — 웹 에디터 + 데이터베이스 MVP (`CHANGELOG.md` 참고)
- **v2.0.0** — Tauri 데스크톱 이식, SQLite 로컬 저장 ← 진행 중
- v3.0.0 — AWS Cognito + Google OAuth + 화이트리스트 인증
- v4.0.0 — Lambda + DynamoDB 동기화, S3 이미지 업로드
- v5.0.0 — 실시간 협업 (AppSync), 자동 업데이트 (GitHub Actions)

## 기여·보안

- 개발·PR 절차: `CONTRIBUTING.md`
- 취약점 신고: `SECURITY.md`

## 라이선스

MIT
