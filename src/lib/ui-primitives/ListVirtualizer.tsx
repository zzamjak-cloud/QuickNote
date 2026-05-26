// 긴 리스트 가상화 wrapper. @tanstack/react-virtual 위에서 동작.
// 사용 예:
//   <ListVirtualizer
//     count={rows.length}
//     estimateSize={() => 40}
//     overscan={6}
//   >
//     {({ index, style }) => <div style={style}>{rows[index].name}</div>}
//   </ListVirtualizer>
//
// 스크롤 컨테이너를 외부에서 제어해야 하면 parentRef prop 으로 전달한다.
// 미전달 시 내부 ref 의 div 가 자체 스크롤 컨테이너가 된다.
import { Fragment, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface ListVirtualizerProps {
  /** 총 행 수. */
  count: number;
  /** 각 행 추정 높이 px (실 측정으로 자동 보정). */
  estimateSize: (index: number) => number;
  /** 미리 그릴 상하단 여유분. 기본 5. */
  overscan?: number;
  /** 외부 스크롤 컨테이너 ref. 미전달 시 내부 div 가 컨테이너. */
  parentRef?: RefObject<HTMLDivElement | null>;
  /** 행 렌더 함수. style 에 transform/translateY 가 들어가므로 그대로 적용해야 한다. */
  children: (ctx: { index: number; style: CSSProperties }) => ReactNode;
  /** 컨테이너 div 의 추가 className (parentRef 미전달일 때만). */
  className?: string;
  /** 컨테이너 div style. */
  style?: CSSProperties;
}

export function ListVirtualizer({
  count,
  estimateSize,
  overscan = 5,
  parentRef,
  children,
  className,
  style,
}: ListVirtualizerProps) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = parentRef ?? internalRef;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const inner = (
    <div style={{ height: totalSize, width: "100%", position: "relative" }}>
      {items.map((item) => (
        <Fragment key={item.key as string | number}>
          {children({
            index: item.index,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: item.size,
              transform: `translateY(${item.start}px)`,
            },
          })}
        </Fragment>
      ))}
    </div>
  );

  if (parentRef) return inner;

  return (
    <div ref={internalRef} className={className} style={{ overflow: "auto", ...style }}>
      {inner}
    </div>
  );
}
