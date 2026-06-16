# 번들 최적화 (코드 분할 · manualChunks)

초기 eager 청크에서 무거운 의존성을 제거해 첫 로드를 줄인다.
설정: `vite.config.ts` 의 `rollupOptions.output.manualChunks`.

## lazy 분리된 영역

| 영역 | 방식 | 커밋 |
|------|------|------|
| IconPickerPanel / IconPickerEmoji | `IconPickerPanel.tsx` 로 추출, 4개 사용처(IconPicker/Editor/Callout/tabBlock)에서 `React.lazy`+`Suspense` 지연 로드 | `3252782e` |
| markdown 미리보기(react-markdown/remark-gfm) | `MarkdownPreviewRender.tsx` 로 분리해 NodeView 내부 `React.lazy` | `3252782e` |
| emoji-picker-react | manualChunks 의 `emoji-picker-vendor` 청크 → eager→lazy 전환 | `3252782e` |
| lowlight / highlight.js | Editor 가 `import("lowlight")`·hljs 테마 CSS 를 **동적** 로드 | `3e70e63f` |

결과(측정값): 메인 `index` gzip 369 → 314 kB(`3252782e`). lowlight(172KB/gzip~55KB)가
초기 modulepreload 체인에서 빠짐(`3e70e63f`).

## manualChunks 룰 (`vite.config.ts`)

named vendor 청크로 묶는 것 — react-vendor, tiptap-vendor, dnd-vendor, lucide-vendor,
emoji-picker-vendor, amplify-vendor, db-vendor(dexie), auth-vendor(oidc-client-ts/jwt-decode).

### lowlight/hljs 는 named 청크로 묶지 않는다 (중요)
`vite.config.ts:37-39` 주석 참고. Editor 가 동적 import 하므로 named chunk 로 두면
Vite 가 **eager modulepreload(+테마 CSS eager)로 승격**시킨다. 규칙을 빼면 동적 import 경계로
자연 코드분할되어 lazy 로드된다. **lowlight 를 다시 manualChunks 에 넣지 말 것.**

### lowlight ref 동일성 (회귀 주의)
`3e70e63f` 에서 lowlight 를 안정 ref 위임 wrapper(`useRef`)로 감싸 동기 ref 동일성을 유지한다.
이걸 깨면 에디터 재생성(콜스택 초과 #9983)이 재발한다. `codeBlockLowlightStable.ts` 의
`isRegistered` 도 hljs core 정적 import 대신 lowlight 인스턴스 API 를 쓴다(동작 불변).

## 회수된 초기 청크 요약
- lowlight/hljs core + 테마 CSS (`main.tsx` eager hljs CSS 제거)
- emoji-picker-react
- IconPicker 카탈로그/커스텀 패널
- react-markdown/remark-gfm
