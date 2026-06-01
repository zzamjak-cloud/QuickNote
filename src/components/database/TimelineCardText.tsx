// 일반 DB 타임라인과 LC 스케줄러가 공유하는 일정 카드 내부 텍스트(제목·기간·속성 라벨) 렌더러.
// 두 곳 모두 동일 포맷이라 공통화한다.
//
// 핵심 책임:
// - 긴 카드가 좌측으로 스크롤될 때 제목/속성 텍스트가 화면(첫 컬럼 우측) 안에 남도록 transform 오프셋 적용.
// - 포커싱 애니메이션 중 React 리렌더 없이 매 프레임 transform 을 직접 갱신할 수 있도록
//   카드 기하 정보를 data-* 속성으로 노출(timelineCardStickyOffset.applyTimelineCardStickyOffset 가 사용).
//   data 속성 이름은 timelineCardStickyOffset.ts 의 TIMELINE_CARD_TEXT_ATTR 와 일치해야 한다.
import type { CSSProperties, ReactNode } from "react";

type Props = {
  // 트랙(타임라인) 기준 카드 좌측 px. sticky 오프셋 계산용.
  cardLeft: number;
  cardWidth: number;
  // 현재 스크롤 위치 기준으로 caller 가 계산한 오프셋(px).
  contentOffset: number;
  title: string;
  titleClassName?: string;
  // 빈 문자열/undefined 이면 기간 라벨을 렌더하지 않는다.
  dateLabel?: string | null;
  dateClassName?: string;
  dateStyle?: CSSProperties;
  // 카드 종류별로 다른 패딩/폰트 등은 caller 가 지정.
  containerClassName: string;
  // 속성 라벨 컴포넌트(DB 와 스케줄러가 서로 다른 props 를 쓰므로 children 으로 주입).
  children?: ReactNode;
};

export function TimelineCardText({
  cardLeft,
  cardWidth,
  contentOffset,
  title,
  titleClassName,
  dateLabel,
  dateClassName,
  dateStyle,
  containerClassName,
  children,
}: Props) {
  return (
    <div
      data-timeline-card-text="true"
      data-card-left={cardLeft}
      data-card-width={cardWidth}
      className={containerClassName}
      style={contentOffset ? { transform: `translateX(${contentOffset}px)` } : undefined}
    >
      <span className={`shrink-0 ${titleClassName ?? ""}`}>{title}</span>
      {dateLabel != null && dateLabel !== "" && (
        <span className={`shrink-0 ${dateClassName ?? ""}`} style={dateStyle}>
          {dateLabel}
        </span>
      )}
      {children}
    </div>
  );
}
