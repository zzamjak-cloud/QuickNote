// 사이드바 헤더용 알림 벨 + 드롭다운 (fixed + 뷰포트 클램프)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Trash2 } from "lucide-react";
import { useNotificationStore } from "../../store/notificationStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  findBlockPositionById,
  scrollToBlockId,
} from "../../lib/editor/editorNavigationBridge";
import { computeDropdownBelowAnchor } from "../../lib/ui/clampFloatingPanel";
import { waitForPageDeepLink } from "../../lib/navigation/waitForPageDeepLink";
import {
  markNotificationReadApi,
  deleteMyNotificationApi,
} from "../../lib/sync/notificationApi";

const PANEL_W = 320;
/** 헤더+목록 근사 높이 — 위치 클램프용 */
const EST_PANEL_H = 340;
const NAV_RETRY_MS = 80;
const NAV_MAX_ATTEMPTS = 35;

function afterStableLayout(fn: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(fn, 40);
    });
  });
}

function focusNotificationTarget(
  blockId: string,
  onFocused: (blockStart: number) => void,
  attempt = 0,
): void {
  const blockStart = findBlockPositionById(blockId);
  if (blockStart !== null && scrollToBlockId(blockId)) {
    onFocused(blockStart);
    return;
  }
  if (attempt >= NAV_MAX_ATTEMPTS) return;
  window.setTimeout(
    () => focusNotificationTarget(blockId, onFocused, attempt + 1),
    NAV_RETRY_MS,
  );
}

export function NotificationBell() {
  const me = useMemberStore((s) => s.me);
  const members = useMemberStore((s) => s.members);
  const notificationItems = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const markAllReadForMember = useNotificationStore((s) => s.markAllReadForMember);

  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const open = useUiStore((s) => s.notificationCenterOpen);
  const toggleNotificationCenter = useUiStore((s) => s.toggleNotificationCenter);
  const closeNotificationCenter = useUiStore((s) => s.closeNotificationCenter);
  const openCommentThread = useUiStore((s) => s.openCommentThread);
  const showToast = useUiStore((s) => s.showToast);

  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  // 여러 인스턴스 중 이 벨이 직접 열었을 때만 포털을 렌더
  const [isThisAnchor, setIsThisAnchor] = useState(false);

  const memberId = me?.memberId;
  const items = memberId
    ? notificationItems
        .filter((x) => x.recipientMemberId === memberId || x.recipientMemberId === `m:${memberId}`)
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];
  const unread = items.filter((x) => !x.read).length;

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
    if (!open) setIsThisAnchor(false);
  }, [open]);

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
      if (
        t instanceof HTMLElement &&
        t.closest("[data-qn-notification-panel], [data-qn-notification-bell]")
      ) {
        return;
      }
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
  const notificationWorkspaceLabel = (n: (typeof items)[number]) =>
    n.workspaceName ? `(${n.workspaceName})` : "";
  const metaLabelOf = (n: (typeof items)[number]) => {
    if (n.kind === "thread_reply") return "답글";
    if (n.source === "page") return "페이지 멘션";
    return "댓글 멘션";
  };
  const pageTitleOf = (n: (typeof items)[number]) =>
    n.pageTitle ||
    usePageStore.getState().pages[n.pageId]?.title ||
    "페이지";

  const commentBadgeAnchorFor = (blockId: string) => {
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(blockId)
        : blockId.replace(/["\\]/g, "\\$&");
    const el = document.querySelector<HTMLElement>(
      `[data-qn-comment-badge-block-id="${escaped}"]`,
    );
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  };

  const onNavigate = (id: string): void => {
    void (async () => {
      const n = useNotificationStore.getState().items.find((x) => x.id === id);
      if (!n) return;
      markRead(n.id);
      markNotificationReadApi(n.id).catch(() => {});
      closeNotificationCenter();

      const switchWorkspace =
        Boolean(n.workspaceId) && n.workspaceId !== currentWorkspaceId;
      if (switchWorkspace && n.workspaceId) {
        setCurrentWorkspaceId(n.workspaceId);
        setCurrentTabPage(null);
      }

      const loaded = await waitForPageDeepLink({
        pageId: n.pageId,
        workspaceId: n.workspaceId ?? undefined,
      });
      if (!loaded) {
        showToast(
          "페이지를 불러오지 못했습니다. 네트워크 또는 권한을 확인한 뒤 다시 시도하세요.",
          { kind: "error" },
        );
        return;
      }

      setCurrentTabPage(n.pageId);
      setActivePage(n.pageId);
      // 페이지 레벨 댓글(sentinel) — 블록 스크롤 없이 페이지로만 이동
      if (n.blockId === "__page__") return;
      afterStableLayout(() => {
        focusNotificationTarget(n.blockId, (blockStart) => {
          afterStableLayout(() => {
            focusNotificationTarget(n.blockId, (stableBlockStart) => {
              if (n.source !== "page") {
                openCommentThread({
                  pageId: n.pageId,
                  blockId: n.blockId,
                  blockStart: stableBlockStart || blockStart,
                  anchorViewport: commentBadgeAnchorFor(n.blockId),
                });
              }
            });
          });
        });
      });
    })();
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        data-qn-notification-bell
        onClick={() => { setIsThisAnchor(true); toggleNotificationCenter(); }}
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

      {open && panelPos && isThisAnchor ? createPortal(
        <div
          ref={panelRef}
          data-qn-notification-panel
          className="fixed z-[9999] w-80 max-w-[calc(100vw-16px)] rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onNavigate(n.id);
                    }}
                    onClick={(e) => e.preventDefault()}
                  >
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
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
                      <span className="min-w-0 truncate text-zinc-500">
                        {pageTitleOf(n)}
                      </span>
                      {notificationWorkspaceLabel(n) ? (
                        <span className="shrink-0 text-zinc-400">
                          {notificationWorkspaceLabel(n)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      {metaLabelOf(n)}
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
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeNotification(n.id);
                      deleteMyNotificationApi(n.id).catch(() => {});
                    }}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
