// 사이드바 헤더용 알림 벨 + 드롭다운 (fixed + 뷰포트 클램프)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { useNotificationStore } from "../../store/notificationStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { scrollToBlockId } from "../../lib/editor/editorNavigationBridge";
import { computeDropdownBelowAnchor } from "../../lib/ui/clampFloatingPanel";

const PANEL_W = 320;
/** 헤더+목록 근사 높이 — 위치 클램프용 */
const EST_PANEL_H = 340;

export function NotificationBell() {
  const me = useMemberStore((s) => s.me);
  const members = useMemberStore((s) => s.members);
  const listForMember = useNotificationStore((s) => s.listForMember);
  const unreadCountForMember = useNotificationStore((s) => s.unreadCountForMember);
  const markRead = useNotificationStore((s) => s.markRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const markAllReadForMember = useNotificationStore((s) => s.markAllReadForMember);

  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  const open = useUiStore((s) => s.notificationCenterOpen);
  const toggleNotificationCenter = useUiStore((s) => s.toggleNotificationCenter);
  const closeNotificationCenter = useUiStore((s) => s.closeNotificationCenter);
  const openCommentThread = useUiStore((s) => s.openCommentThread);

  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const memberId = me?.memberId;
  const items = memberId ? listForMember(memberId) : [];
  const unread = memberId ? unreadCountForMember(memberId) : 0;

  const reposition = useCallback((): void => {
    const el = bellRef.current;
    if (!el || !open) {
      setPanelPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const pos = computeDropdownBelowAnchor({
      anchor: {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
      },
      panelWidth: PANEL_W,
      panelHeight: EST_PANEL_H,
    });
    setPanelPos(pos);
  }, [open]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition, items.length]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      const bell = bellRef.current;
      if (bell?.contains(t)) return;
      closeNotificationCenter();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, closeNotificationCenter]);

  if (!memberId) return null;

  const nameOf = (id: string) => members.find((m) => m.memberId === id)?.name ?? "구성원";

  const onNavigate = (id: string) => {
    const n = useNotificationStore.getState().items.find((x) => x.id === id);
    if (!n) return;
    markRead(n.id);
    closeNotificationCenter();
    setActivePage(n.pageId);
    setCurrentTabPage(n.pageId);
    window.setTimeout(() => {
      scrollToBlockId(n.blockId);
      openCommentThread({
        pageId: n.pageId,
        blockId: n.blockId,
        blockStart: 0,
      });
    }, 80);
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        data-qn-notification-bell
        onClick={() => toggleNotificationCenter()}
        className="relative rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        aria-label="알림"
        title="알림"
      >
        <Bell size={15} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-[5px] text-[10px] font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open && panelPos ? (
        <div
          ref={panelRef}
          className="fixed z-[300] w-80 max-w-[calc(100vw-16px)] rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
          role="menu"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
              알림
            </span>
            {unread > 0 ? (
              <button
                type="button"
                className="text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
                onClick={() => markAllReadForMember(memberId)}
              >
                모두 읽음
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-zinc-500">
                알림이 없습니다.
              </p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={[
                    "group flex gap-2 border-b border-zinc-100 px-2 py-2 last:border-0 dark:border-zinc-800",
                    n.read ? "bg-white dark:bg-zinc-900" : "bg-emerald-50/80 dark:bg-emerald-950/30",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onNavigate(n.id)}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span
                        className={[
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          n.read ? "bg-zinc-300 dark:bg-zinc-600" : "bg-emerald-500",
                        ].join(" ")}
                        aria-hidden
                      />
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">
                        {nameOf(n.fromMemberId)}
                      </span>
                      <span className="text-zinc-400">
                        {n.kind === "mention" ? "멘션" : "답글"}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-800 dark:text-zinc-100">
                      {n.previewBody}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 self-start rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-zinc-800"
                    aria-label="알림 삭제"
                    title="삭제"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeNotification(n.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
