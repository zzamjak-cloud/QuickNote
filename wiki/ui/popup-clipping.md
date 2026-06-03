# 팝업 화면 클리핑 금지 규약

## 원칙
모든 팝업·드롭다운·팝오버·메뉴 리스트는 뷰포트 바깥으로 잘려서는 안 된다.

## 표준 구현
셀/버튼 기준 팝오버 → **반드시** `useAnchoredPopover` 사용 (`src/hooks/useAnchoredPopover.ts`)

자동 처리 항목:
- 1차 위치: 트리거 아래
- 화면 아래 넘치면 트리거 위로 자동 플립
- 좌·우 화면 안쪽으로 클램프 (8px 패딩)
- resize/scroll/콘텐츠 크기 변화 시 ResizeObserver 로 재계산

## `useAnchoredPopover` 미적용 케이스
(자유 부유 패널, 마우스 좌표 기반 등)
동일한 클램프·플립 로직을 직접 구현. 가능하면 공용 유틸로 분리.

## 금지
- `position: fixed` 좌표만 박고 화면 경계 검사 생략
- 컨테이너 `overflow: hidden` 안에 팝업 절대 위치 (Portal로 body에 렌더해야 함)

## 검증 시나리오
새 팝업 추가 시 반드시 확인:
- 작은 화면에서 열기
- 화면 오른쪽/하단 가장자리 근처 트리거
- 스크롤 중간 상태

## 관련 위키
- [anchored-popover.md](anchored-popover.md)
- [pickerview-toolbar.md](pickerview-toolbar.md)
