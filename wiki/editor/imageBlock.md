# imageBlock

## 역할
TipTap Image extension을 확장한 커스텀 이미지 노드. `quicknote-image://` 스킴 URL을 비동기로 PreSignedURL로 해석해 렌더하며, width/height/align/caption 등 추가 속성을 스키마에 등록한다. `ImageResizeOverlay`가 이 extension의 `width`/`height` 속성을 `updateAttributes`로 수정한다.

## 위치
`src/lib/tiptapExtensions/imageBlock.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `ImageBlock` | TipTap Extension | `Image.extend()`로 생성한 커스텀 이미지 extension |
| `ImageView` | React 컴포넌트 (내부) | 이미지 NodeView 렌더러 (memo) |

## 노드 속성 (addAttributes)
| 속성 | 기본값 | 설명 |
|------|--------|------|
| `src` | `null` | 이미지 URL. `quicknote-image://` 스킴이면 `data-qn-src`로 HTML에 저장 (브라우저 직접 로드 차단) |
| `alt` | (부모 상속) | 대체 텍스트 |
| `width` | `null` | 픽셀 단위 너비. 없으면 `max-w-full` |
| `height` | `null` | 픽셀 단위 높이 |
| `id` | `null` | 블록 고유 ID (`data-id`) |
| `align` | `"left"` | 정렬 (`left` / `center` / `right`) |
| `caption` | `null` | 캡션 텍스트 (`data-caption`) |
| `captionAlign` | `"left"` | 캡션 정렬 (`data-caption-align`) |

## 렌더 동작 (ImageView)
- `useImageUrl(attrs.src)` 훅으로 `quicknote-image://` 스킴을 PreSignedURL로 비동기 해석
- `attrs.width`가 있으면 `style="width: Npx; max-width: 100%"`, 없으면 `max-width: 100%`만 적용
- `align` → `ALIGN_TO_FLEX` 맵으로 `alignItems` flex 값 변환 (`left` → `flex-start`, `center` → `center`, `right` → `flex-end`)
- 더블클릭 시 전체화면 미리보기 모달 열림
- `shallowImageAttrsEqual`로 불필요한 리렌더 방지 (src/alt/width/height/align/caption/captionAlign/id/selected 비교)

## NodeView 설정
- `ReactNodeViewRenderer(ImageView, { as: "div" })` — 정렬·캡션을 위해 블록 컨테이너(`div`)로 렌더
- `allowBase64: false` — 대용량 data URL을 문서 JSON에 저장하지 않음

## 키보드 단축키
| 단축키 | 동작 |
|--------|------|
| `Mod+Shift+C` / `Ctrl+Shift+C` | 선택된 이미지의 캡션 토글 (`toggleSelectedMediaCaption`) |

## 의존 관계
- `useImageUrl` (`lib/images/hooks`) — URL 해석 훅
- `mediaCaption.ts` — `toggleSelectedMediaCaption`, `nextCaptionAlign`, `CaptionAlign` 타입
- `@tiptap/extension-image` — 베이스 extension

### 이 파일을 사용하는 곳
- `useEditorExtensions.ts` — `ImageBlock.configure({ allowBase64: false })`로 등록
- `ImageResizeOverlay.tsx` — `updateAttributes("image", { width, height })`로 크기 저장

## 주의사항 (회귀 이력 있음)

- **`addAttributes` 필수**: `@tiptap/extension-image` 기본 스키마에는 `width`/`height`/`align`/`caption`이 없다. `ImageBlock.extend`의 `addAttributes`에서 직접 등록해야 `ImageResizeOverlay`의 `updateAttributes`가 동작하고 새로고침 후에도 크기가 유지된다. 누락 시 항상 `undefined` → 컬럼 전체 너비로 표시된다.
- **NodeView wrapper `as: "div"`**: 정렬 지원을 위해 블록 레벨 컨테이너로 렌더. `span`으로 변경하면 인라인 흐름이 되어 레이아웃이 깨진다. `selectednode` 시각 스타일은 CSS에서 내부 `<img>`에만 적용된다.
- **`src` renderHTML 처리**: `quicknote-image://` 또는 `quicknote-file://` 스킴은 `src=""`로 차단하고 `data-qn-src`에 원본 값을 보존한다. `parseHTML`에서 `data-qn-src`를 우선 읽어 복원한다.
- **`ImageResizeOverlay` 연계**: 오버레이는 `editor.view.nodeDOM(sel.from)`에서 `querySelector("img")`로 실제 이미지 rect를 측정한다. NodeView DOM 구조가 변경되면 측정 로직도 함께 확인해야 한다.
