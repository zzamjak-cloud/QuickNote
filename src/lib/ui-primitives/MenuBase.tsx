// 메뉴/드롭다운 베이스. PopoverBase + 키보드 네비(↑↓ Enter Esc).
// items 슬롯: { id, label, onSelect, disabled? } 의 배열을 받아 렌더.
// 더 복잡한 메뉴(서브메뉴/구분선)는 PopoverBase 를 직접 사용.
import { useEffect, useState, type ReactNode } from "react";
import { PopoverBase, type PopoverTriggerCtx } from "./PopoverBase";

export interface MenuItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface MenuBaseProps {
  /** 메뉴 폭 px. 기본 200. */
  width?: number;
  /** 트리거 슬롯. */
  trigger: (ctx: PopoverTriggerCtx) => ReactNode;
  /** 메뉴 항목들. */
  items: MenuItem[];
  /** 선택 불가한 헤더 영역 (예: 현재 사용자 정보). items 위에 렌더된다. */
  header?: ReactNode;
  /** 컨텐츠 컨테이너 추가 클래스. */
  contentClassName?: string;
}

export function MenuBase({
  width = 200,
  trigger,
  items,
  header,
  contentClassName,
}: MenuBaseProps) {
  return (
    <PopoverBase
      width={width}
      trigger={trigger}
      contentClassName={
        contentClassName ??
        "overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      }
      content={({ close }) => (
        <>
          {header ? (
            <div className="border-b border-zinc-100 dark:border-zinc-800">
              {header}
            </div>
          ) : null}
          <MenuItemList items={items} onClose={close} />
        </>
      )}
    />
  );
}

function MenuItemList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 향후 Dialog 안에 Menu 가 중첩될 때 ESC 한 번에 두 레이어 모두 닫히는 것을 막는다
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[active];
        if (item && !item.disabled) {
          item.onSelect();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, active, onClose]);

  return (
    <div>
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
            i === active
              ? "bg-zinc-100 dark:bg-zinc-800"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          } ${item.disabled ? "cursor-not-allowed text-zinc-400" : "text-zinc-700 dark:text-zinc-200"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
