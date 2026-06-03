# 피커뷰 툴바/팝업 회귀 방지

## 반복 회귀 증상
- 우측 화면 밖으로 밀림
- 피커뷰 팝업 뒤로 숨음
- 스크롤 컨테이너 기준 좌표를 `fixed` 좌표처럼 쓰는 문제

## 필수 규칙
1. 툴바/드롭다운은 피커뷰 내부 DOM 이 아니라 `document.body` Portal 로 렌더
2. 좌표 계산: 대상 element 의 `getBoundingClientRect()` + `visualViewport.offsetLeft/offsetTop`
3. X축: `viewportLeft + padding` ~ `viewportLeft + viewportWidth - popupWidth - padding` 으로 clamp
4. Y축: 아래 우선 배치 후 부족하면 위로 flip, resize/scroll/크기 변화 시 재계산
5. z-index: 피커뷰 패널보다 높아야 함

## 배치 기준
미디어 블럭 툴바 → block wrapper 전체가 아니라 **실제 이미지/비디오/파일 shell rect** 기준

## 검증 체크리스트
- [ ] 피커뷰를 오른쪽 가장자리에서 열기
- [ ] 좁은 화면에서 열기
- [ ] 스크롤 중간 상태에서 열기
- [ ] 이미지/동영상 툴바가 화면 안에 남는지 확인
- [ ] 피커뷰 뒤로 숨지 않는지 확인
- [ ] hover/click 대상이 가려지지 않는지 확인
