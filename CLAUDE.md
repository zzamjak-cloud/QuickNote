# QuickNote 프로젝트 가이드

## 언어 규칙

- 모든 코드 주석: **한국어**
- 모든 응답, 커밋 메시지: **한국어**
- 변수명, 함수명 등 식별자: **영어**

---

## 기술 스택

- **프론트엔드**: React + TypeScript + Vite + Tailwind CSS
- **에디터**: TipTap (ProseMirror 기반)
- **상태 관리**: Zustand (persist 미들웨어 적용)
- **백엔드**: AWS AppSync (GraphQL) + Lambda (Node.js)
- **인프라**: AWS CDK (`infra/` 디렉토리)
- **로컬 스토리지**: 웹 → localStorage, 네이티브 → Tauri SQLite
- **동기화**: LWW(Last-Write-Wins) + IndexedDB outbox 큐

---

## 배포 순서 (반드시 지킬 것)

### 스키마/API 변경이 포함된 작업

```
1. CDK 배포 (Lambda 리졸버 먼저)
   cd infra && npx cdk deploy --all

2. 프론트엔드 배포 (CDK 배포 확인 후)
   npm run build

3. Zustand persist 버전 bump (스키마 변경 시만)
   → 아래 "스키마 버전 관리" 섹션 참고
```

**이 순서를 어기면:**
- CDK 미배포 상태에서 프론트 배포 → AppSync 뮤테이션 실패 → 데이터가 로컬에만 쌓임
- 이후 localStorage 마이그레이션 → 로컬 캐시 초기화 → **데이터 영구 손실**

---

## 스키마 버전 관리

### Zustand persist 버전 변경이 필요한 경우

`Page`, `Database` 타입에 **필수 필드 추가/제거/이름 변경** 시:

**1. `src/store/pageStore.ts`**
```ts
// version 숫자를 +1
version: 2,
migrate: (persisted: unknown, fromVersion: number) => {
  if (fromVersion < 1) return { pages: {}, activePageId: null };
  if (fromVersion < 2) {
    // v1 → v2 마이그레이션: 새 필드에 기본값 주입
    const data = persisted as { pages: Record<string, unknown> };
    for (const page of Object.values(data.pages)) {
      (page as Record<string, unknown>).newField ??= defaultValue;
    }
    return data;
  }
  return persisted;
},
```

**2. `src/store/databaseStore.ts`** — 동일한 패턴 적용

### 규칙

| 변경 종류 | version bump 필요 |
|-----------|:-----------------:|
| 필수 필드 추가 | ✅ |
| 필드 이름 변경 | ✅ |
| 필드 삭제 | ✅ |
| 선택적 필드 추가 (`?`) | ❌ (기본값 있으면 불필요) |
| 로직만 변경 | ❌ |

---

## 동기화 아키텍처

```
로컬 액션 (createPage 등)
  → Zustand 스토어 업데이트 (즉시 UI 반영)
  → IndexedDB outbox 적재 (src/lib/sync/engine.ts)
  → AppSync GraphQL 뮤테이션 전송
  → 성공: outbox에서 제거
  → 실패: 지수 백오프 재시도 (1s → 2s → ... → 60s)

원격 변경 수신
  → AppSync 구독 (WebSocket)
  → LWW 충돌 해결 (src/lib/sync/storeApply.ts)
  → Zustand 스토어 업데이트

네트워크 복구 시
  → window 'online' 이벤트
  → AppSync 구독 즉시 재연결
  → 원격 전체 재페치 (fetchPagesByWorkspace)
  → outbox flush (오프라인 중 쌓인 mutations 전송)
```

### 소스 오브 트루스

```
AppSync (원격)  ←  진실의 원천
localStorage    ←  빠른 첫 렌더용 캐시 (원격의 스냅샷)
```

로컬 캐시는 보조 수단이며 언제든 원격에서 재구성 가능해야 합니다.

---

## 데이터 손실 방지 체크리스트

새 기능 작업 시작 전:

- [ ] `infra/` 변경이 있는가? → CDK 배포 먼저
- [ ] `Page` 또는 `Database` 타입이 변경되는가? → persist version 계획 수립
- [ ] AppSync 스키마(`infra/graphql/`)가 변경되는가? → 프론트 타입 동기화 확인

작업 완료 후 머지 전:

- [ ] CDK 배포 완료 확인
- [ ] 개발 환경에서 페이지 생성 → 웹에서 즉시 보이는지 확인
- [ ] persist version이 변경됐다면 마이그레이션 테스트 완료

---

## 디버깅: 데이터가 사라진 경우

**Step 1: outbox 확인**
```
브라우저 DevTools → Application → IndexedDB → (앱명) → outbox 테이블
```
entries가 있으면 → 뮤테이션이 서버에 전달되지 않은 것 (CDK 미배포 또는 네트워크 문제)

**Step 2: AppSync 로그 확인**
```
AWS 콘솔 → AppSync → Logging → 최근 요청 에러 확인
```

**Step 3: localStorage 직접 확인**
```js
// 브라우저 콘솔
JSON.parse(localStorage.getItem('quicknote.pages.v1') ?? '{}')
JSON.parse(localStorage.getItem('quicknote.databases.v1') ?? '{}')
```

**Step 4: localStorage 초기화 (최후 수단)**
```js
["quicknote.pages.v1","quicknote.databases.v1","quicknote.settings.v1"]
  .forEach(k => localStorage.removeItem(k));
location.reload();
// → Bootstrap이 AppSync에서 전체 재페치함
```

---

## 주요 파일 위치

| 역할 | 경로 |
|------|------|
| 동기화 엔진 (outbox) | `src/lib/sync/engine.ts` |
| AppSync 구독 (재연결) | `src/lib/sync/subscribers.ts` |
| LWW 충돌 해결 | `src/lib/sync/storeApply.ts` |
| 앱 부트스트랩 (초기 페치) | `src/Bootstrap.tsx` |
| 페이지 스토어 | `src/store/pageStore.ts` |
| DB 스토어 | `src/store/databaseStore.ts` |
| CDK 인프라 | `infra/` |
