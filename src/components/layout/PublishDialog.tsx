// 페이지 "웹에 게시" 다이얼로그 — 게시 상태 조회·게시/해제·공개 URL 복사.
import { useEffect, useState } from "react";
import { Globe, Copy, Loader2 } from "lucide-react";
import { DialogBase } from "../../lib/ui-primitives";
import { useUiStore } from "../../store/uiStore";
import {
  getPagePublishStatusRevision,
  usePagePublishStatusStore,
} from "../../store/pagePublishStatusStore";
import {
  buildPublicPageUrl,
  getPagePublishStatusApi,
  publishPageApi,
  unpublishPageApi,
  type PagePublishStatus,
} from "../../lib/sync/publishApi";

type Props = {
  pageId: string | null;
  onClose: () => void;
};

export function PublishDialog({ pageId, onClose }: Props) {
  const showToast = useUiStore((s) => s.showToast);
  const setPublished = usePagePublishStatusStore((s) => s.setPublished);
  const applyFetchedStatus = usePagePublishStatusStore(
    (s) => s.applyFetchedStatus,
  );
  const [status, setStatus] = useState<PagePublishStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const open = pageId !== null;

  useEffect(() => {
    if (!pageId) {
      setStatus(null);
      return;
    }
    let canceled = false;
    const expectedRevision = getPagePublishStatusRevision(pageId);
    setStatus(null);
    setLoading(true);
    getPagePublishStatusApi(pageId)
      .then((s) => {
        if (canceled) return;
        setStatus(s);
        applyFetchedStatus(pageId, s.published, expectedRevision);
        // 이미 게시된 페이지면, 현재 레이아웃(전체너비) 설정을 게시 스냅샷에 재반영한다
        // (토큰·링크 유지). 게시 후 자식 페이지 너비를 바꿔도 공유 링크만 다시 열면 반영됨.
        // 편집 권한이 없으면(뷰어) 조용히 무시 — 링크 복사 흐름은 방해하지 않는다.
        if (s.published) {
          publishPageApi(pageId)
            .then((refreshed) => {
              if (!canceled) {
                setStatus(refreshed);
                setPublished(pageId, refreshed.published);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!canceled) {
          applyFetchedStatus(pageId, false, expectedRevision);
          showToast("게시 상태를 불러오지 못했습니다.", { kind: "error" });
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [applyFetchedStatus, pageId, setPublished, showToast]);

  const publicUrl = status?.token ? buildPublicPageUrl(status.token) : null;
  // Preview/로컬 게시는 해당 환경 DB 토큰이라 khaki·시크릿 창에서 404 난다.
  const isNonLiveWebHost =
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http") &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    window.location.hostname !== "quick-note-khaki.vercel.app" &&
    !window.location.hostname.endsWith(".tauri.localhost");

  const runPublishToggle = () => {
    if (!pageId || working) return;
    setWorking(true);
    const action = status?.published ? unpublishPageApi : publishPageApi;
    action(pageId)
      .then((next) => {
        setStatus(next);
        setPublished(pageId, next.published);
        showToast(
          next.published ? "웹에 게시되었습니다." : "게시가 해제되었습니다.",
          { kind: "success" },
        );
      })
      .catch(() =>
        showToast(
          status?.published ? "게시 해제에 실패했습니다." : "게시에 실패했습니다.",
          { kind: "error" },
        ),
      )
      .finally(() => setWorking(false));
  };

  const copyUrl = () => {
    if (!publicUrl) return;
    void navigator.clipboard
      .writeText(publicUrl)
      .then(() => showToast("공개 링크 복사 완료!", { kind: "success" }))
      .catch(() => showToast("링크 복사에 실패했습니다.", { kind: "error" }));
  };

  return (
    <DialogBase
      open={open}
      onClose={onClose}
      widthClassName="max-w-md"
      labelId="qn-publish-dialog-title"
    >
      <DialogBase.Header id="qn-publish-dialog-title">
        <span className="inline-flex items-center gap-2">
          <Globe size={16} /> 웹에 게시
        </span>
      </DialogBase.Header>
      <DialogBase.Body>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 size={14} className="animate-spin" /> 게시 상태 확인 중…
          </p>
        ) : status?.published && publicUrl ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              이 페이지와 모든 하위 페이지가 웹에 공개돼 있습니다. 링크를 아는
              사람은 로그인 없이 읽을 수 있습니다.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={publicUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              />
              <button
                type="button"
                onClick={copyUrl}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Copy size={12} /> 복사
              </button>
            </div>
            <p className="text-xs text-zinc-400">
              게시를 해제하면 링크가 즉시 무효화되며, 다시 게시하면 새 링크가
              발급됩니다.
            </p>
            {isNonLiveWebHost ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                지금 앱은 개발(Preview) 환경입니다. 이 링크는 시크릿 창·라이브
                도메인(
                <span className="font-mono">quick-note-khaki.vercel.app</span>
                )에서 열리지 않습니다. 외부 공유·시크릿 검증은 라이브에서 다시
                게시하세요.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              게시하면 이 페이지와 모든 하위 페이지를 링크를 아는 누구나 로그인
              없이 읽을 수 있습니다(검색엔진 비노출).
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              본문에 언급(@)된 멤버 이름도 함께 공개되니 주의하세요.
            </p>
            {isNonLiveWebHost ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                시크릿 창에서 확인하려면{" "}
                <span className="font-mono">quick-note-khaki.vercel.app</span>{" "}
                (라이브)에서 게시한 링크를 쓰세요. Preview 링크는 Vercel 로그인
                보호로 막히거나, 라이브와 DB가 달라 404가 납니다.
              </p>
            ) : null}
          </div>
        )}
      </DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          닫기
        </button>
        <button
          type="button"
          disabled={loading || working}
          onClick={runPublishToggle}
          className={[
            "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50",
            status?.published
              ? "bg-red-500 hover:bg-red-600"
              : "bg-blue-600 hover:bg-blue-700",
          ].join(" ")}
        >
          {working ? <Loader2 size={14} className="animate-spin" /> : null}
          {status?.published ? "게시 해제" : "게시"}
        </button>
      </DialogBase.Footer>
    </DialogBase>
  );
}
