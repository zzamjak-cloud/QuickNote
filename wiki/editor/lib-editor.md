# lib/editor — 에디터 유틸리티 모음

## 역할
`src/components/editor/` 컴포넌트에서 사용하는 에디터 관련 순수 유틸 및 브릿지 모듈. 이미지·파일 삽입, 드래그&드롭, 내비게이션, 블록 삽입, 테이블 재정렬 등의 로직을 컴포넌트와 분리해 관리한다.

## 위치
`src/lib/editor/`

## 파일별 역할

### 이미지·파일 삽입
| 파일 | 주요 export | 설명 |
|------|------------|------|
| `insertImageFromFile.ts` | `insertImageFromFile` | `File` 객체를 받아 S3 업로드 후 `ImageBlock` 노드 삽입. 5MB 초과 시 `onSizeExceeded` 콜백 호출 |
| `insertFileFromFile.ts` | `insertFileFromFile` | 파일을 `FileBlock` 노드로 삽입 |
| `clipboardFiles.ts` | — | 클립보드·드래그 이벤트에서 파일 목록 추출 유틸 |

### 드래그&드롭
| 파일 | 주요 export | 설명 |
|------|------------|------|
| `blockDropTarget.ts` | `BlockDropIndicatorRect`, 관련 유틸 | 블록 드래그 중 드롭 위치 rect 계산 |
| `editorHandleDrop.ts` | `BlockDropIndicatorRect`, `ColumnDropState`, 드롭 핸들러 | 블록·컬럼 드롭 이벤트 처리 로직 |
| `tableReorderDrag.ts` | — | 테이블 행/열 드래그 재정렬 로직 |
| `tableHeaders.ts` | `isHeaderRowActive`, `isHeaderColActive`, `applyHeaderRowToggle`, `applyHeaderColToggle` | 표 헤더행/헤더열 판별·토글. TipTap toggleHeader 명령 신뢰성 문제로 PM 트랜잭션 직접 처리. `TableBlockControls`(행/열 그립 메뉴)와 `BlockHandles`(표 블록 좌상단 핸들 메뉴)가 공유 |
| `tableColumnWidths.ts` | `getSelectedColumnCount`, `distributeSelectedColumnsEvenly` | CellSelection 으로 연속 다중 열 선택 시, 선택 열 전체 너비를 열 개수로 균등 분배(colwidth 갱신). `BubbleToolbar` 의 "균등 너비" 버튼에서 호출 |

### 내비게이션
| 파일 | 주요 export | 설명 |
|------|------------|------|
| `editorNavigationBridge.ts` | `registerEditorNavigation`, `unregisterEditorNavigation`, `scrollToBlockId`, `scrollToSearchHit` | 페이지 내 블록 ID 기반 스크롤 이동. 에디터 외부(검색 결과 등)에서 에디터 뷰를 제어하기 위한 브릿지 |
| `pendingNavigation.ts` | `peekPendingNavigation`, `consumePendingNavigation` | 페이지 전환 전 예약된 내비게이션(블록 ID 스크롤) 관리. peek/consume 패턴으로 단일 소비 보장 |

### 블록 삽입
| 파일 | 주요 export | 설명 |
|------|------------|------|
| `insertBlockSmart.ts` | `insertBlockSmart` | 현재 커서 위치 기준으로 적절한 위치에 블록 삽입 (빈 단락이면 교체, 아니면 뒤에 삽입) |

### 레지스트리
| 파일 | 주요 export | 설명 |
|------|------------|------|
| `editorByPageRegistry.ts` | `registerEditorForPage`, `getEditorForPage` | 페이지 ID → editor 인스턴스 맵. 에디터 외부에서 특정 페이지의 editor에 접근할 때 사용 |

### 테스트
| 위치 | 설명 |
|------|------|
| `__tests__/` | lib/editor 유틸 단위 테스트 디렉토리 |

## 의존 관계

### 이 디렉토리를 사용하는 주요 컴포넌트
| 사용처 | 사용 파일 |
|--------|----------|
| `Editor.tsx` | `insertImageFromFile`, `editorNavigationBridge`, `pendingNavigation`, `editorByPageRegistry`, `editorHandleDrop` |
| `useEditorProps.ts` | `editorHandleDrop`, `clipboardFiles`, `insertImageFromFile`, `insertFileFromFile` |
| `TableBlockControls.tsx` | `tableReorderDrag`, `tableHeaders` |
| `BlockHandles.tsx` | `tableHeaders` (표 블록 좌상단 핸들 메뉴의 헤더행/열 토글) |
| `BubbleToolbar.tsx` | `tableColumnWidths` (다중 열 선택 시 균등 너비 버튼) |

## 주의사항
- **`editorNavigationBridge`**: 에디터 마운트 시 `registerEditorNavigation`, 언마운트 시 `unregisterEditorNavigation`을 호출해야 한다. 미호출 시 검색 결과 클릭 등 외부 스크롤 이동이 동작하지 않는다.
- **`pendingNavigation` peek/consume 패턴**: `peekPendingNavigation`은 소비하지 않고 값만 읽는다. `consumePendingNavigation`은 읽은 후 초기화한다. 에디터 마운트 시 `consume`으로 한 번만 처리해야 중복 스크롤을 방지할 수 있다.
- **`editorByPageRegistry`**: 피크 뷰처럼 여러 에디터 인스턴스가 동시에 존재할 수 있으므로, `pageId`를 키로 정확한 인스턴스를 조회해야 한다.
- **`insertImageFromFile`**: `Editor.tsx`에서 `onSizeExceeded` 콜백으로 `setSimpleAlert`를 연결해 사용자에게 5MB 초과 경고를 표시한다. 새 진입점에서 이 함수를 사용할 때도 콜백을 반드시 처리해야 한다.
- **`blockDropTarget` / `editorHandleDrop`**: `BlockDropIndicatorRect`와 `ColumnDropState` 타입은 `Editor.tsx`의 state 타입으로도 사용된다. 타입 변경 시 Editor 컴포넌트의 state 선언도 함께 확인한다.
