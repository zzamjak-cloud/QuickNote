// 에디터 위에 핸들/오버레이를 그리기 위한 공통 컨테이너 베이스.
// positioning="absolute"(기본): 부모 relative 박스에 맞춤 — BlockHandles, ColumnReorderHandles 등.
// positioning="fixed": 뷰포트 전체에 걸쳐 고정 — TableBlockControls 드래그 오버레이 등.
// 자식은 반드시 자체적으로 `pointer-events-auto` 를 지정해야 한다.
import { forwardRef, type CSSProperties, type ReactNode } from "react";

export interface HandleLayerBaseProps {
  /** "absolute"(기본) 또는 "fixed". */
  positioning?: "absolute" | "fixed";
  /** z-index 클래스. 기본 z-10. */
  zClassName?: string;
  /** 디버그/스타일 훅용 data-* 어트리뷰트. */
  dataAttrs?: Record<string, string>;
  /** 추가 클래스. */
  className?: string;
  /** 인라인 스타일. */
  style?: CSSProperties;
  children: ReactNode;
}

export const HandleLayerBase = forwardRef<HTMLDivElement, HandleLayerBaseProps>(
  function HandleLayerBase(
    { positioning = "absolute", zClassName = "z-10", dataAttrs, className, style, children },
    ref,
  ) {
    return (
      <div
        ref={ref}
        {...(dataAttrs ?? {})}
        className={`pointer-events-none ${positioning} inset-0 ${zClassName}${className ? ` ${className}` : ""}`}
        style={style}
      >
        {children}
      </div>
    );
  },
);
