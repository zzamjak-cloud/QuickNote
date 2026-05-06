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
- **버전 히스토리** — 페이지/DB 버전 기록, 다중 선택 삭제, 호환 불가 스냅샷 자동 숨김
- 행 페이지/피크에서도 우측 메뉴로 `다른 페이지로 이동`과 페이지 버전 히스토리 제공
- 행 전체 페이지 열기 아이콘 `Ctrl/Cmd + 클릭` 시 새 탭 열기, 뒤로가기 시 이전 DB 문맥 복귀
- `다른 페이지로 이동`에서 페이지/DB 통합 검색 + 일반 페이지↔DB 항목 변환 지원
- DB는 중첩 실삽입 대신 **참조 행**으로 관리
- 사이드바 하단 **데이터베이스 관리**에서 활성 DB 확인, 삭제 DB 복원, DB 바로 열기

### 단축키

| 단축키 | 동작 |
|---|---|
| `Cmd/Ctrl + N` | 새 페이지 |
| `Cmd/Ctrl + K` | 사이드바 검색 포커스 |
| `Cmd/Ctrl + /` | 다크 모드 토글 |
| `Cmd/Ctrl + Shift + ↑/↓` | 현재 블록 위/아래로 이동 |
| `Ctrl/Cmd + 클릭 (행 전체페이지 아이콘)` | 행 페이지 새 탭 열기 |
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

### 자동 업데이트 릴리스 규약 (Tag Push)

- 자동 업데이트 배포는 `v*` 태그 푸시에서만 실행된다.
- 버전은 반드시 세 곳이 일치해야 한다.
  - `package.json`의 `version`
  - `src-tauri/tauri.conf.json`의 `version`
  - 푸시 태그 `vX.Y.Z`
- 릴리스 순서
  1. 버전 bump
  2. `CHANGELOG.md` 갱신
  3. `git tag vX.Y.Z && git push origin vX.Y.Z`
- GitHub Secrets 필요
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **데스크톱/GitHub Actions 릴리스**에서는 로컬 `.env`가 쓰이지 않는다. `npm run build`가 CI에서 실행될 때 `VITE_*`가 주입되어야 프로덕션 앱에서 Google 로그인이 동작한다. 아래 이름으로 Repository Secrets를 등록할 것 (`CONTRIBUTING.md` 참고).
  - `VITE_COGNITO_REGION`
  - `VITE_COGNITO_USER_POOL_ID`
  - `VITE_COGNITO_HOSTED_UI_DOMAIN`
  - `VITE_COGNITO_DESKTOP_CLIENT_ID`
  - `VITE_AUTH_REDIRECT_DESKTOP`
  - (선택·웹과 동일 소스 빌드 시) `VITE_COGNITO_WEB_CLIENT_ID`, `VITE_AUTH_REDIRECT_WEB`
- `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에는 minisign 공개키를 넣어야 한다.

## 데이터 저장

| 환경 | 저장소 |
|---|---|
| 웹 | 브라우저 `localStorage` |
| 데스크톱 (v2+) | 로컬 SQLite (`~/.local/share/quicknote/quicknote.db`) |

## 인증 (v3.0.0+)

웹/데스크톱 모두 **AWS Cognito User Pool + Google OAuth** 페더레이션으로 로그인한다. 화이트리스트에 등록된 이메일만 가입할 수 있다.

- 웹: Hosted UI 로 리다이렉트 → Google → `/auth/callback`
- 데스크톱(Tauri): 시스템 기본 브라우저로 Hosted UI 오픈 → `quicknote://auth/callback` 딥링크로 복귀
- 토큰: PKCE Authorization Code 흐름. `oidc-client-ts` + `zustandStorage` 어댑터로 영속화
- 화이트리스트: Cognito PreSignUp Lambda 가 `ALLOWED_EMAILS` 와 매칭되지 않는 가입을 거부

인프라(CDK) 배포·환경변수 설정 방법은 `infra/README.md` 와 `.env.example` 참고.

## 동기화 (v4.0.0+)

웹/데스크톱 모두 **AWS AppSync (Cognito JWT 인증)** 로 페이지·DB·연락처를 자동 동기화한다.

- 페이지 단위 LWW (`updatedAt` 비교)
- 오프라인 편집은 IndexedDB(웹) / SQLite(Tauri) outbox 큐에 누적, 온라인 복귀 시 자동 재시도(지수 백오프)
- 페이지 doc 변경은 2초 디바운스, 메타·DB·연락처는 즉시 푸시
- 이미지는 S3 PreSignedURL 로 업로드 (≤ 20MB, png/jpeg/webp/gif). 에디터 doc 안에는 `quicknote-image://{id}` 가상 스킴으로 영구 ID 만 보유
- 동기화 비대상: 페이지/DB 히스토리, 디바이스별 UI 설정(다크모드·사이드바 폭·탭), 인증 토큰

배포·환경변수: `infra/README.md` 의 `QuicknoteSyncStack` 절 참고.

## 로드맵

- **v1.0.0** — 웹 에디터 + 데이터베이스 MVP (`CHANGELOG.md` 참고)
- **v2.0.0** — Tauri 데스크톱 이식, SQLite 로컬 저장, 태그 릴리스·자동 업데이트(minisign + GitHub Actions)
- **v3.0.0** — AWS Cognito + Google OAuth + 화이트리스트 인증
- **v4.0.0** — AWS AppSync 단일 사용자 멀티 디바이스 동기화 (LWW) + S3 이미지 업로드 ← 완료
- v5.0.0 — 다중 사용자 실시간 협업 (CRDT/Yjs)

## 기여·보안

- 개발·PR 절차: `CONTRIBUTING.md`
- 취약점 신고: `SECURITY.md`

## 라이선스

MIT
