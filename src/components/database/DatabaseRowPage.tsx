import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useShallow } from "zustand/react/shallow";
import { useDatabaseStore } from "../../store/databaseStore";
import { Editor } from "../editor/Editor";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageCommentBar, PAGE_COMMENT_SENTINEL } from "../comments/PageCommentBar";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { computeEditorTailSpacerPx } from "../editor/editorHelpers";
import { PageTitleBar } from "../page/PageTitleBar";
import { DbPropertySection } from "../page/DbPropertySection";
import { PageCoverImage } from "../editor/PageCoverImage";
import { useSettingsStore } from "../../store/settingsStore";
import { PAGE_TITLE_DUPLICATE_MESSAGE, preparePageTitleInput } from "../../store/pageStore/helpers";
import { getEditorColumnClass } from "../../lib/editorLayout";
import { useIsMobile } from "../../hooks/useViewport";

export function DatabaseRowPage({ pageId }: { pageId: string }) {
  // doc 필드는 Editor 컴포넌트가 내부에서 직접 구독 — 여기서는 메타 필드만 구독해 불필요한 리렌더 방지
  const page = usePageStore(
    useShallow((s) => {
      const p = s.pages[pageId];
      if (!p) return undefined;
      return { title: p.title, icon: p.icon, coverImage: p.coverImage, databaseId: p.databaseId, parentId: p.parentId };
    }),
  );
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);
  const setCoverImage = usePageStore((s) => s.setCoverImage);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const fullWidth = pageId ? (pageFullWidthById[pageId] ?? globalFullWidth) : globalFullWidth;
  const isMobile = useIsMobile();
  // 본문 Editor 와 동일 기준 — 블록 댓글이 있으면 우측 거터(pr-256)를 예약하므로
  // 헤더 컬럼(제목·속성 패널·댓글바)도 같은 폭으로 전환해야 본문과 정렬이 맞는다.
  const hasPageComments = useBlockCommentStore((s) =>
    s.messages.some(
      (m) => m.pageId === pageId && m.blockId !== PAGE_COMMENT_SENTINEL,
    ),
  );
  // 부트스트랩 하이드레이션 중인지 판별 — 스토어가 아직 비어 있으면 "없음"이 아니라 "로딩 중"이다.
  const pagesEmpty = usePageStore((s) => Object.keys(s.pages).length === 0);
  const databasesEmpty = useDatabaseStore((s) => Object.keys(s.databases).length === 0);

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const titleDraftRef = useRef(titleDraft);
  const [iconAlert, setIconAlert] = useState<string | null>(null);
  const [titleDuplicateAlert, setTitleDuplicateAlert] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [addCommentSignal, setAddCommentSignal] = useState(0);
  const [tailSpacerPx, setTailSpacerPx] = useState(240);
  const tailSpacerPxRef = useRef(tailSpacerPx);

  useEffect(() => {
    const next = page?.title ?? "";
    if (titleDraftRef.current === next) return;
    titleDraftRef.current = next;
    setTitleDraft(next);
  }, [page?.title, pageId]);

  useLayoutEffect(() => {
    const run = (): void => {
      const px = computeEditorTailSpacerPx();
      if (tailSpacerPxRef.current !== px) {
        tailSpacerPxRef.current = px;
        setTailSpacerPx(px);
      }
    };
    run();
    window.addEventListener("resize", run, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run, { passive: true });
    vv?.addEventListener("scroll", run, { passive: true });
    return () => {
      window.removeEventListener("resize", run);
      vv?.removeEventListener("resize", run);
      vv?.removeEventListener("scroll", run);
    };
  }, []);

  if (!page || !databaseId || !bundle) {
    // 새로고침 직후엔 페이지/DB 가 아직 원격에서 도착하지 않았을 수 있다.
    // 스토어가 비었거나(하이드레이션 전) 페이지는 있는데 DB 번들만 아직이면 "로딩 중"으로 표시.
    const hydrating = pagesEmpty || databasesEmpty || (!!page && !bundle);
    return (
      <div className="p-8 text-sm text-zinc-500">
        {hydrating ? "불러오는 중…" : "행 페이지를 찾을 수 없습니다."}
      </div>
    );
  }

  return (
    <div>
      <PageCoverImage
        url={page.coverImage}
        onChange={(url) => setCoverImage(pageId, url)}
        onRemove={() => setCoverImage(pageId, null)}
        onUploadError={(msg) => setIconAlert(msg)}
      />
      <div
        className={`relative mx-auto w-full ${getEditorColumnClass({
          fullWidth,
          hasPageComments,
          isMobile,
        })}`}
        data-qn-row-page-header-column
      >
        <div className={`${page.coverImage ? "mt-12" : "mt-4"} md:px-12`}>
          <div className="mb-4">
            <PageTitleBar
              pageId={pageId}
              icon={page.icon}
              titleDraft={titleDraft}
              titleRef={titleInputRef}
              titleClassName="min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400"
              onTitleChange={(v) => {
                titleDraftRef.current = v;
                setTitleDraft(v);
              }}
              onTitleBlur={() => {
                const nextTitle = preparePageTitleInput(titleDraft);
                if (nextTitle === page.title) return;
                const ok = renamePage(pageId, nextTitle);
                if (!ok) {
                  setTitleDuplicateAlert(true);
                }
              }}
              onTitleKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onIconChange={(icon) => setIcon(pageId, icon)}
              onIconUploadMessage={(msg) => setIconAlert(msg)}
              onAddComment={() => setAddCommentSignal((n) => n + 1)}
              defaultIcon={<FileText size={56} className="text-zinc-400" />}
            />
          </div>

          <DbPropertySection databaseId={databaseId} pageId={pageId} className="mt-3" />
          <PageCommentBar pageId={pageId} openComposerSignal={addCommentSignal} />
        </div>
      </div>
      <Editor
        pageId={pageId}
        bodyOnly
        showTailSpacer={false}
      />
      <div
        aria-hidden
        className="qn-editor-scroll-tail-spacer mx-auto w-full shrink-0 select-none"
        style={{ height: tailSpacerPx, minHeight: tailSpacerPx }}
      />
      <SimpleAlertDialog
        open={iconAlert !== null}
        message={iconAlert ?? ""}
        onClose={() => setIconAlert(null)}
      />
      <SimpleAlertDialog
        open={titleDuplicateAlert}
        message={PAGE_TITLE_DUPLICATE_MESSAGE}
        onClose={() => {
          setTitleDuplicateAlert(false);
          const current = page.title;
          titleDraftRef.current = current;
          setTitleDraft(current);
          window.setTimeout(() => {
            titleInputRef.current?.focus();
            titleInputRef.current?.select();
          }, 0);
        }}
      />
    </div>
  );
}
