# 플로우차트

도형·화살표로 다이어그램을 그리는 커스텀 블록. **편집기·전체보기는 React Flow(`@xyflow/react` v12), 문서 내 읽기전용 미리보기는 정적 SVG**(`FlowchartStaticPreview`)로 그린다 — 미리보기에서 React Flow 의 측정→뷰포트 재계산이 첫 프레임 확대 깜빡임을 일으켜 SVG 로 대체했다(아래 미리보기·회귀 표 참고). 데이터는 `flowchartId` 로 공유되는 **서버 동기 자원**(여러 페이지·복제본·기기 간 동기화)이며, 인라인 `data` 는 오프라인 스냅샷이다.

## 관련 파일

### 클라이언트
- `src/types/flowchart.ts` — 데이터 모델·직렬화(`parseFlowchart`/`serializeFlowchart`)·바운드(`getFlowchartBounds`)·`FlowchartRecord`
- `src/lib/tiptapExtensions/flowchartBlock.tsx` — TipTap atom 노드. attrs: `flowchartId`, `data`, `version`, `title`. `insertFlowchartBlock` 명령
- `src/components/flowchart/shapes.tsx` — 도형 9종 정의(kind/aspect/viewBox/svg/padClass). **React Flow(편집기·전체보기)용**
- `src/components/flowchart/ShapeNode.tsx` — React Flow 도형 노드(편집기·전체보기 공유), 핸들·연결강조·링크아이콘
- `src/components/flowchart/FlowchartStaticPreview.tsx` — **문서 내 읽기전용 미리보기(정적 SVG)**. 도형 외곽선·베지어 엣지·라벨·링크아이콘을 직접 SVG 로 그림(React Flow 미사용)
- `src/components/flowchart/edges.ts` — React Flow 엣지 시각 속성(`edgeVisual`, `defaultEdgeOptions`, `rfEdgeFromData`)
- `src/components/flowchart/FlowchartBlockView.tsx` — NodeView. 미리보기(SVG) 렌더·헤더·마이그레이션·동기화·히스토리·전체보기 진입
- `src/components/flowchart/FlowchartEditorModal.tsx` — 편집 모달(팔레트·캔버스·툴바·중심 스냅·자동저장·우클릭 메뉴)
- `src/components/flowchart/FlowchartLinkDialog.tsx` — 도형 링크(웹 URL / 페이지 멘션) 편집
- `src/components/flowchart/FlowchartFullViewModal.tsx` — 전체보기(줌·팬·Fit, 읽기전용)
- `src/components/flowchart/FlowchartHistoryDialog.tsx` — 버전 히스토리(우측 사이드바, 서버 권위 + 로컬 fallback)
- `src/store/flowchartStore.ts` — 공유 데이터 저장소(IndexedDB persist, LWW `applyRemote`)
- `src/store/flowchartHistoryStore.ts` — 로컬 버전 히스토리(서버 미배포 fallback)
- `src/lib/sync/queries/flowchart.ts` — GraphQL 작업
- `src/lib/sync/flowchartApi.ts` — `fetchFlowchartApi`/`pushFlowchartApi`/`listFlowchartHistoryApi`/`saveFlowchartVersionApi`
- `src/lib/tiptapExtensions/slashMenu/menuEntries.ts` — `/플로우차트` 슬래시 항목
- `src/components/editor/blockHandles/blockTypeFlags.ts` — `flowchartBlock` 타입변경 메뉴 억제
- `src/__tests__/flowchart.test.ts` — 직렬화·바운드 회귀 테스트

### 서버 (배포 필요)
- `infra/lib/sync/schema.graphql` — `Flowchart`/`FlowchartInput`/`FlowchartHistoryEntry` + `getFlowchart`/`listFlowcharts`/`listFlowchartHistory`/`upsertFlowchart`/`softDeleteFlowchart`/`saveFlowchartVersion`
- `infra/lambda/v5-resolvers/handlers/flowchart.ts` — 리졸버 핸들러(LWW upsert, append-only 히스토리)
- `infra/lambda/v5-resolvers/index.ts` — 라우터 등록 + `Flowcharts`/`FlowchartHistory` env→Tables
- `infra/lambda/v5-resolvers/handlers/member.ts` — `Tables.Flowcharts`/`FlowchartHistory`
- `infra/lib/sync-stack.ts` — `FlowchartTable`(+`byWorkspaceAndUpdatedAt` GSI)·`FlowchartHistoryTable`(PK=flowchartId, SK=historyId) + env·권한·AppSync 리졸버
- `infra/lib/sync/ddb-table-factory.ts` — `SyncModelName` 에 `"Flowchart"`

## 데이터 모델

```
FlowchartData = { version, nodes: FlowchartNode[], edges: FlowchartEdge[], viewport? }
FlowchartNode = { id, type:"shape", position{x,y}, data: { label, shape, color?, link? }, width?, height? }
FlowchartEdge = { id, source, target, sourceHandle?, targetHandle?, label?, color? }
FlowchartNodeShape = rectangle|roundRectangle|terminator|ellipse|diamond|parallelogram|hexagon|cylinder|document
FlowchartNodeLink = { type:"url", url } | { type:"page", pageId, label? }
FlowchartRecord = { id, workspaceId, title, data, updatedAt(epoch ms), deletedAt? }  // 공유 저장소·서버 레코드
```

- attrs 의 `data` 는 **항상 JSON 1회 인코딩 문자열**(databaseBlock.panelState 와 동일, Yjs 통짜 교체 안전).
- `parseFlowchart` 는 throw 하지 않음 — 이중 인코딩 1회 더 디코딩, 알 수 없는 shape→rectangle, id 없는 노드·끊긴 엣지(없는 노드 참조) 제거, 깨진 입력→빈 차트.

## 공유·동기화 (핵심)

- 블록 attrs 의 `flowchartId` 가 공유 자원을 가리킨다. 데이터 권위는 **`flowchartStore`(→ 서버)**, 인라인 `data` 는 시드/오프라인 스냅샷.
- **같은 기기**: 같은 `flowchartId` 를 쓰는 모든 블록이 `flowchartStore` 를 구독 → 한 곳 수정 시 전부 즉시 반영.
- **페이지 복제**: 클론된 doc 이 `flowchartId` 를 그대로 유지(`duplicateActions` 가 인라인 attr 미-remap) → 복제본끼리 공유·동기화. **복제=독립이 아니라 공유**가 의도된 동작이다.
- **동기화 해제**(`unbindFlowchartSync`): 블록 드래그 핸들 메뉴 "차트 동기화 해제" → 현재 상태를 새 `flowchartId` 독립 자원으로 분리(새 레코드 upsert + 서버 push). 원본·다른 복제본은 계속 공유되고 이 블록만 떨어져 나온다. **버전 히스토리는 해제 순간을 버전 1로 새로 시작**(원본 히스토리 미승계). 기존 복제→계속 공유 동작은 그대로 유지.
- **크로스 기기**: 블록 마운트 시 `fetchFlowchartApi`→`applyRemote`(서버 최신본 병합), 저장 시 `pushFlowchartApi`(1.5s 디바운스). LWW: `updatedAt`(서버 ISO ↔ 클라 epoch ms 경계 변환).
- **마이그레이션**: 레거시(인라인 전용) 블록은 마운트 시 `flowchartId` 발급 + 인라인 데이터를 store 에 시드(`seedIfAbsent`).
- 로컬 캐싱 = **IndexedDB**(`zustandStorage`→`webStorage`). localStorage 아님.

## 도형 렌더 규칙

도형 정의(`shapes.tsx`)는 **React Flow(편집기·전체보기)** 의 `ShapeNode` 에서 쓰이고, 읽기전용 **미리보기는 `FlowchartStaticPreview` 가 같은 도형을 SVG 외곽선으로 따로 그린다**(두 경로가 시각적으로 일치하도록 도형 형태를 맞춘다). 아래는 `ShapeNode` 의 `kind` 별 방식:

| kind | 도형 | 방식 |
|------|------|------|
| `box` | 사각형·둥근사각형·터미널·원형 | CSS `border`+`border-radius`. 테두리 두께 항상 균일, 왜곡 없음 |
| `parallelogram` | 평행사변형 | `transform: skewX` + CSS border |
| `svg` | 마름모·육각형·원통·문서 | SVG path/polygon, `preserveAspectRatio="xMidYMid meet"`(비율 보존, 안 찌그러짐), `vector-effect="non-scaling-stroke"`(선 두께 균일) |

- 각 도형은 고유 `aspect` 를 노드에 `aspect-ratio` 로 강제 → 도형다운 비율 유지.
- **마름모는 polygon**(대각선이 수평/수직 정렬)이라 폭이 넓어져도 대칭. 회전 정사각형 방식은 비정사각형에서 기울어진 직사각형처럼 보여 폐기함.
- **연결 정점 정렬**: 핸들은 각 변 중앙(= 노드 중심 기준). `FlowchartEditorModal.onNodeDragStop` 이 **노드 중심을 16px 격자에 스냅**(좌상단 스냅은 도형 크기차로 정점이 어긋남).

## 엣지

- 기본 타입 **bezier**(곡선 유지). `edgeVisual(color)` 가 style/markerEnd(ArrowClosed)/label 스타일 일괄 제공.
- **`sourceHandle`/`targetHandle` 저장 필수** — 없으면 React Flow(편집기·전체보기)·SVG 미리보기 모두 임의/추론 핸들로 붙어 화살표가 꼬인다.
- React Flow(편집기·전체보기) **양쪽 모두 `ConnectionMode.Loose`** — 핸들이 전부 `type="source"` 라 Strict 모드면 타겟 핸들을 못 찾아 엣지가 통째로 렌더 안 됨. (SVG 미리보기는 React Flow 미사용이라 무관, 직접 path 로 그림.)
- 편집기 `connectionRadius={48}` + 연결 중 핸들 확대·드롭 대상 헤일로(`useConnection`).
- 엣지 라벨("성공"/"실패")·선 색상은 엣지 선택 시 툴바에서 편집, `edge.data.color` 에 보관.

## 미리보기 (FlowchartStaticPreview) — 정적 SVG

문서 내 읽기전용 미리보기는 **React Flow 가 아니라 정적 SVG**다. 이유: React Flow 는 캐시 데이터라도 컨테이너 크기를 측정→뷰포트(배율) 재계산해야 그려지는데, 마운트 첫 페인트엔 그 측정 전이라 **확대된 프레임이 보였다가 보정되며 깜빡인다**. controlled viewport·visibility 가림·fitView 조정으로도 이 측정→재계산 사이클을 못 막아 SVG 로 대체했다.

- `<svg viewBox="minX minY width height" preserveAspectRatio="xMidYMid meet" width=100% height=100%>` → **브라우저가 네이티브로 즉시 스케일**. JS 측정·재계산·비동기·리마운트가 없어 첫 프레임부터 정확, 깜빡임 없음. 데이터 변경 시 viewBox 만 바뀌어 자동 재맞춤.
- 컨테이너 높이 = 차트 바운딩박스 비율(`aspect-ratio`, `getFlowchartBounds` 의 minX/minY/width/height). **상한 없음** — 세로로 길수록 박스도 커진다.
- 도형 = SVG 외곽선(`shapeOutline`), 라벨 = `<foreignObject>`(편집기 textarea 와 동일한 줄바꿈), 엣지 = 베지어 `path` + `context-stroke` 마커(선 색을 화살표가 따라감), 끊긴/누락 핸들은 노드 상대 위치로 변(side) 추론.
- 링크 있는 도형 클릭 → 외부는 `window.open` 새 탭, 내부는 `useOpenPageInPeek`(피크). 링크 도형만 `cursor:pointer`. 컨테이너 더블클릭 → 편집 모달.
- 헤더: 좌측 제목(호버 시 편집 필드), 우측 **버전 히스토리**·**전체보기** 아이콘.

> 편집기·전체보기는 React Flow 를 그대로 쓴다(상호작용 필요, 사용자가 연 모달이라 마운트 깜빡임 무방).

## 링크

- 도형 우클릭(`onNodeContextMenu`) → "링크 추가/편집/제거" 컨텍스트 메뉴.
- `FlowchartLinkDialog`: "웹 링크"(URL, 스킴 없으면 `https://` 보정) / "페이지 연결"(`loadMergedMentionItems` 페이지 검색).
- **페이지 멘션 id 는 `p:` 접두**(`mentionItems`) — `stripPagePrefix` 로 실제 페이지 id 저장. 미적용 시 피크가 페이지를 못 찾음("불러오지 못했습니다").

## 자동 저장·전체보기·버전 히스토리

- **자동 저장**: 편집 모달 60초 인터벌, 변경 없으면 스킵(`onAutoSave`).
- **전체보기**(`FlowchartFullViewModal`): 큰 팝업에 읽기전용 + 줌/팬/Fit(Controls)/미니맵.
- **버전 히스토리**: 저장 시마다 스냅샷 적립(직전과 동일하면 dedup). 로컬(`flowchartHistoryStore`, IndexedDB) + 서버(`saveFlowchartVersion`, `FlowchartHistory` 테이블). 다이얼로그는 열 때 서버 로드(권위), 미배포/오류 시 로컬 fallback. 복원 = 해당 스냅샷을 현재로 저장(동기화·새 버전 적립).

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 마름모가 기울어진 직사각형 | 회전 정사각형 방식(비정사각형에서 비대칭) → polygon SVG 로 교체 |
| 육각형·원통 찌그러짐 | `preserveAspectRatio="none"` 가 강제 스트레치 → `xMidYMid meet` + 노드 `aspect-ratio` |
| 도형 테두리 두께 불균일 | SVG 에 `vector-effect="non-scaling-stroke"` 누락 |
| 미리보기에서 화살표 안 보임 | 뷰어가 기본 `Strict` 모드 → 양쪽 `ConnectionMode.Loose` 필요 |
| 재진입 시 화살표 위치 꼬임 | 저장 시 `sourceHandle`/`targetHandle` 유실 → 직렬화에 보존 |
| 연결 정점이 격자에 안 맞음 | 좌상단 스냅 → **중심 스냅**(`onNodeDragStop`) |
| **미리보기 첫 프레임 확대 후 깜빡임** | React Flow 의 컨테이너 측정→뷰포트 재계산이 마운트 시 1프레임 확대를 유발. controlled viewport·visibility 가림·fitView 조정 모두 불완전 → **읽기전용 미리보기를 정적 SVG(`FlowchartStaticPreview`)로 대체해 근본 해결** |
| 미리보기 세로로 길수록 내용 작아짐 | (구 React Flow 미리보기) `maxHeight` 캡 → 제거. 현재 SVG 미리보기는 viewBox 네이티브 스케일이라 무관 |
| 페이지 클릭마다 미리보기 튕김 | (구 React Flow 미리보기) `applyRemote` 동일 데이터 교체 → 직렬화 비교 스킵. 현재 SVG 미리보기는 측정·재계산이 없어 무관 |
| 편집기↔미리보기 화살표 정렬 어긋남 | (구) span≠textarea 크기차. 현재 SVG 미리보기 라벨은 `foreignObject` 로 편집기 textarea 와 동일 줄바꿈 |
| 페이지 링크 클릭 시 안 열림 | `p:` 접두 미제거 → `stripPagePrefix` |
| 드래그 핸들에 타입변경 메뉴 뜸 | `blockTypeFlags.ts` 제외 목록에 `flowchartBlock` 추가 |

## 서버 추가 지점 (새 필드/리졸버 시)

스키마(`schema.graphql`) + 핸들러(`handlers/flowchart.ts`) + 라우터(`index.ts`) + Tables(`member.ts`+env) + CDK 리졸버(`sync-stack.ts` `v5Ds.createResolver`) **동시 수정**. 배포: `cd infra && npm run deploy:dev`(dev) — 새 테이블·리졸버는 배포 전까지 클라가 graceful fallback(인라인/로컬).
