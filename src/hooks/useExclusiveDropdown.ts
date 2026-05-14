// 한 번에 하나의 드롭다운만 열리도록 강제하는 훅.
// 다른 드롭다운이 열리는 시점에 현재 열린 것을 자동으로 닫는다.
// 그룹 키(group)별로 독립 — 같은 그룹 내에서만 배타적.

import { useCallback, useEffect, useId, useRef, useState } from "react";

const CHANNEL_PREFIX = "qn-dropdown-open:";

type OpenEventDetail = { id: string };

export function useExclusiveDropdown(group: string = "default"): {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  toggle: () => void;
  close: () => void;
} {
  const id = useId();
  const [open, setOpenState] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  // 다른 드롭다운이 열렸을 때 자동 닫기
  useEffect(() => {
    const channel = `${CHANNEL_PREFIX}${group}`;
    const handler = (e: Event) => {
      const ev = e as CustomEvent<OpenEventDetail>;
      if (ev.detail?.id !== id && openRef.current) {
        setOpenState(false);
      }
    };
    document.addEventListener(channel, handler);
    return () => document.removeEventListener(channel, handler);
  }, [group, id]);

  const broadcastOpen = useCallback(() => {
    const channel = `${CHANNEL_PREFIX}${group}`;
    document.dispatchEvent(
      new CustomEvent<OpenEventDetail>(channel, { detail: { id } }),
    );
  }, [group, id]);

  const setOpen = useCallback(
    (v: boolean | ((p: boolean) => boolean)) => {
      setOpenState((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        if (next && !prev) {
          // 열리는 순간에만 다른 드롭다운에 알림
          queueMicrotask(broadcastOpen);
        }
        return next;
      });
    },
    [broadcastOpen],
  );

  const toggle = useCallback(() => setOpen((p) => !p), [setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

  return { open, setOpen, toggle, close };
}
