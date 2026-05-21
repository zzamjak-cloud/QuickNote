// 데이터베이스 셀 에디터 베이스.
// display 슬롯(트리거 버튼 내용) + editor 슬롯(팝오버 내용) 으로 분리한다.
// 셀 클릭 → 편집 팝오버 토글, ESC/외부 클릭 → 닫기 는 PopoverBase 에서 흡수.
import type { ReactNode } from "react";
import { PopoverBase, type PopoverContentCtx } from "./PopoverBase";

export interface CellEditorBaseProps {
  /** 셀(트리거 버튼)에 표시할 내용 — 칩, 텍스트, 아이콘 등. */
  display: ReactNode;
  /** 편집 팝오버 내용을 렌더하는 함수. close 호출 시 팝오버 닫힘. */
  editor: (ctx: PopoverContentCtx) => ReactNode;
  /** 팝오버 폭 px. */
  width?: number;
  /** 셀 버튼의 title 속성. */
  title?: string;
  /** 셀 버튼 추가 className. 기본은 hover 배경 + 작은 패딩. */
  triggerClassName?: string;
  /** 컨텐츠 컨테이너 추가 className. */
  contentClassName?: string;
}

const DEFAULT_TRIGGER_CLASS =
  "flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800";

export function CellEditorBase({
  display,
  editor,
  width = 200,
  title,
  triggerClassName,
  contentClassName,
}: CellEditorBaseProps) {
  return (
    <PopoverBase
      width={width}
      contentClassName={contentClassName}
      trigger={({ buttonRef, toggle }) => (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => toggle(width)}
          title={title}
          className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
        >
          {display}
        </button>
      )}
      content={editor}
    />
  );
}
