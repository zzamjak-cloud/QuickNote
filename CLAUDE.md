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

## 버전 동기화 (배포 전 필수)

GitHub Actions `Publish Release` 워크플로우는 다음 세 값이 **모두 일치**해야 통과한다:

| 파일 | 키 |
|------|----|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| git 태그 | `v{version}` |

**버전 bump 시 반드시 두 파일을 함께 수정하고, 커밋 후 태그를 생성한다.**

```bash
# 올바른 순서
1. package.json "version" 수정
2. src-tauri/tauri.conf.json "version" 수정
3. CHANGELOG.md 업데이트
4. git commit
5. git tag v{version}
6. git push origin main && git push origin v{version}
```

> 반복 실패 이력: 태그 생성 전 `src-tauri/tauri.conf.json` 버전 누락으로 Actions 실패 다수 발생.

### npm 패키지 버전 충돌 (Vercel 배포 실패)

Vercel은 기본적으로 strict peer dependency 검사를 수행한다. 로컬에서 `--legacy-peer-deps`로 설치한 패키지가 있으면 Vercel 빌드가 실패한다.

**해결책:** 프로젝트 루트에 `.npmrc` 파일을 유지한다.

```
legacy-peer-deps=true
```

**새 패키지 설치 시 주의:**
- 기존 패키지 버전과 peer dependency가 맞지 않는 패키지를 설치할 경우, 반드시 다른 관련 패키지 버전도 함께 맞춰서 올리거나 `.npmrc`가 있는지 확인한다.
- 특히 TipTap 패키지는 모든 `@tiptap/*` 패키지의 버전이 **동일**해야 한다. (예: `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-*` 전부 같은 버전)
- 실패 사례: `@tiptap/extension-text-align@3.23.4` + `@tiptap/core@3.22.5` → ERESOLVE 오류

---

## 배포 순서 (반드시 지킬 것)

### 스키마/API 변경이 포함된 작업

```
1. CDK 배포 (Lambda 리졸버 먼저)
   cd infra && npx cdk deploy --all

2. 프론트엔드 배포 (CDK 배포 확인 후)
   npm run build
   - `Page.blockComments` 는 항상 GraphQL 조회·구독·upsert 에 포함된다(CDK 스키마에 필드가 있어야 함).

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
| 박스 드래그 마퀴 | `src/hooks/boxSelect/useBoxSelectMarquee.ts` |
| CDK 인프라 | `infra/` |

---

## 박스 드래그 선택 회귀 방지

페이지 빈 공간(에디터 좌우 padding·블록 사이·마지막 블록 아래)에서 마우스 드래그 시 점선 사각형이 시각화되며 다중 블록을 선택하는 기능. **반복 회귀 이력**이 있으니 코드 변경 시 다음 사항 점검:

### 정상 동작 흐름

1. `mousedown` (capture phase) → `onMouseDown` (`useBoxSelectMarquee.ts`)
2. target 검사 — early return 분기:
   - `editorHost.contains(target)` 외부면 종료
   - `INTERACTIVE_SELECTOR`(button/input/[role='dialog'] 등) 매치 시 종료
   - `isInsideAnyBlock(view, target)` true면 종료(블록 내부)
3. 빈 공간이면 `beginMarqueeTracking` → body에 `qn-box-select-tracking` 클래스 추가
4. `mousemove` `MARQUEE_ACTIVATE_PX` 이상 → `qn-box-select-dragging` 추가 + `.qn-box-select-rect` div 표시
5. `mouseup` → 선택 확정

### 회귀 발생 시 점검 항목

**증상별 의심 위치**:

| 증상 | 의심 위치 |
|------|-----------|
| 사각형 자체가 안 그려짐 | `.qn-box-select-rect` CSS(`src/index.css`)의 `z-index`·`position` 깨짐, 다른 element가 더 높은 z-index로 가림 |
| body class 안 붙음(`""`) | `onMouseDown`이 호출 안 됨 → useEffect 자체 미동작 또는 capture listener race |
| `skip:inside-block` 분기로 빠짐 | `isInsideAnyBlock`이 의도치 않게 true 반환 → PM dom 구조 변경 또는 `editor.view.dom` reference stale |
| `skip:interactive` 분기 | 새로 추가한 ancestor가 `INTERACTIVE_SELECTOR`에 매치 (예: 페이지 헤더에 `[role='dialog']` 추가 등) |
| 텍스트가 선택됨 | marquee 시작 자체가 실패 → PM 자체 mousedown으로 fall through |

### 진단 절차 (다시 회귀하면)

`useBoxSelectMarquee.ts`의 `onMouseDown` 도입부에 임시 로그를 넣어 분기 추적 (이전 진단 commit `93a412e` 참고):

```ts
const dbg = (reason: string, extra?: Record<string, unknown>) => {
  console.log("[QN-DEBUG] marquee:mousedown", reason, {
    targetTag: target.tagName,
    targetCls: target.className,
    isViewDom: target === editor.view.dom,
    ...extra,
  });
};
// 각 early return 직전에 dbg("skip:reason"), 마지막 beginMarqueeTracking 직전 dbg("BEGIN")
```

또한 사용자에게 다음 콘솔 진단 요청 가능:
- `document.querySelector('.qn-box-select-rect')` — overlay div가 DOM에 있는지
- `document.body.className` — 드래그 시도 중 `qn-box-select-tracking`/`qn-box-select-dragging` 클래스 부착 여부
- mousedown event의 `target.tagName` + `className` (어떤 element가 잡히는지)

### 변경 시 주의

- **에디터 컬럼 레이아웃 변경**(`Editor.tsx`의 `.overflow-y-auto`, `data-qn-editor-column`) 시 `editor.view.dom.closest()` 가 의도한 host 를 잡는지 확인.
- **새 absolute/fixed element**가 페이지에 추가되면 `pointer-events-none` 또는 `z-index` 가 marquee overlay를 가리지 않는지 확인.
- **새 mousedown capture listener**가 `stopImmediatePropagation` 호출하지 않는지 확인.
- **PM dom 의 padding 영역(`px-12 py-8`)** 에서도 marquee 가 시작되어야 함 — `isInsideAnyBlock`이 `target === view.dom` 케이스에서 false 반환하는 동작을 깨뜨리지 말 것.

---

## 이미지 크기 조정 회귀 방지

이미지 클릭 시 8개 핸들이 이미지 크기에 정확히 정렬되어 비율 유지 리사이즈가 가능해야 함. 두 차례 회귀 이력 — 핸들이 행 전체 너비에 그려지거나 width/height 가 저장 안 되는 형태.

### 정상 동작 흐름

1. 이미지 클릭 → PM 이 `NodeSelection` 생성 (image 는 atom)
2. `ImageResizeOverlay.measure` 가 `editor.view.nodeDOM(sel.from)` 으로 wrapper 획득
3. wrapper 내부의 `<img>` 요소를 `querySelector("img")` 로 찾아 그 `getBoundingClientRect` 로 핸들 위치 계산
4. 핸들 드래그 → `editor.chain().setNodeSelection(pos).updateAttributes("image", { width, height }).run()`
5. `ImageBlock` extension 의 `addAttributes` 가 width/height 를 schema 에 저장 → doc 에 영구 보관
6. NodeView 가 `attrs.width` 를 `<img width=... style="width:Npx; max-width:100%">` 로 렌더

### 회귀 발생 시 점검 항목

| 증상 | 의심 위치 |
|------|-----------|
| 핸들이 이미지 옆이 아닌 행 양 끝에 그려짐 | `ImageResizeOverlay.measure` 가 outer wrapper 만 측정 — `querySelector("img")` 로 inner 측정 누락 |
| 클릭 시 selection 파란 박스가 행 전체 너비 | `ReactNodeViewRenderer(Comp, { as: "span" })` 누락 — outer wrapper 가 기본값 `div` 라 block 으로 row 전체 차지 |
| 크기 조정해도 새로고침 시 원복 | `ImageBlock.extend` 에 `addAttributes` 누락 — width/height 가 schema 에 등록 안 됨 |
| 이미지가 항상 자연 크기 또는 column 전체 너비 | `addAttributes` 누락 + 렌더 시 `attrs.width` 가 항상 undefined |
| 핸들 자체가 안 보임 | `box.width < 8` early return / `nodeDOM` 이 null / `selection` 이 `NodeSelection` 아님 |

### 진단 절차

1. 이미지가 렌더링되는지 + width 가 적용되는지:
   ```js
   document.querySelectorAll('.qn-image-shell img').forEach(i =>
     console.log({ renderedW: i.width, attrW: i.getAttribute('width'), styleW: i.style.width })
   )
   ```
2. 클릭 시 `ImageResizeOverlay.measure` 분기 추적 — 각 단계에 `console.log` 추가:
   - `selType` / `nodeName`
   - `nodeDOM` 의 `tagName` / `className`
   - 측정 box 의 `width` / `height`
3. wrapper outer 가 `react-renderer node-image` 이면 → `as: "span"` 설정 안 됨
4. wrapper 의 `getBoundingClientRect.width` 가 행 전체 너비면 → block-level 로 fallthrough 중

### 변경 시 주의

- **`@tiptap/extension-image`** 기본 schema 에는 width/height 가 없다. ImageBlock 확장에서 `addAttributes` 로 직접 등록해야 함 (`src/lib/tiptapExtensions/imageBlock.tsx`).
- **NodeView wrapper**(`as` 옵션)와 **ReactNodeViewRenderer wrapper**(2번째 인자의 `as`)는 별개. 둘 다 inline 흐름이 필요하면 둘 다 `span` 지정.
- **ImageResizeOverlay 측정**은 항상 wrapper → inner img 순으로 fallback. wrapper 만 측정하면 NodeView 구조 변경 시 항상 깨짐.
- **CSS `max-w-full`** 만으로는 사용자 지정 width 를 보존하지 못함. 인라인 `style.width` 로 명시.
