// 에디터 위에 핸들/오버레이를 그리기 위한 공통 컨테이너.
// BlockHandles / ColumnReorderHandles 가 공통으로 사용한 패턴:
//   <div className="pointer-events-none absolute inset-0 z-XX">
//     ...핸들들 (각 자식이 pointer-events-auto 로 입력을 받음)
//   </div>
// 자식은 반드시 자체적으로 `pointer-events-auto` 를 지정해야 한다.
import { forwardRef, type CSSProperties, type ReactNode } from "react";

export interface HandleLayerProps {
  /** z-index 클래스. 기본 z-10. 메뉴 열림 시 더 올리고 싶으면 호출처에서 조건부 전달. */
  zClassName?: string;
  /** 디버그/스타일 훅용 data-* (예: data-qn-editor-chrome="..."). */
  dataAttrs?: Record<string, string>;
  /** 추가 클래스. */
  className?: string;
  /** 인라인 스타일. */
  style?: CSSProperties;
  children: ReactNode;
}

export const HandleLayer = forwardRef<HTMLDivElement, HandleLayerProps>(
  function HandleLayer(
    { zClassName = "z-10", dataAttrs, className, style, children },
    ref,
  ) {
    return (
      <div
        ref={ref}
        {...(dataAttrs ?? {})}
        className={`pointer-events-none absolute inset-0 ${zClassName}${className ? ` ${className}` : ""}`}
        style={style}
      >
        {children}
      </div>
    );
  },
);
