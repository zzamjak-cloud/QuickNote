import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useShallow } from "zustand/react/shallow";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Editor } from "../editor/Editor";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { PageCommentBar, PAGE_COMMENT_SENTINEL } from "../comments/PageCommentBar";
import { computeEditorTailSpacerPx } from "../editor/editorHelpers";
import { PageSubpageTree, countPageDescendants } from "../page/PageSubpageTree";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { getEditorColumnClass } from "../../lib/editorLayout";
import { PageTitleBar } from "../page/PageTitleBar";
import { DbPropertySection } from "../page/DbPropertySection";

export function DatabaseRowPage({ pageId }: { pageId: string }) {
  // doc 필드는 Editor 컴포넌트가 내부에서 직접 구독 — 여기서는 메타 필드만 구독해 불필요한 리렌더 방지
  const page = usePageStore(
    useShallow((s) => {
      const p = s.pages[pageId];
      if (!p) return undefined;
      return { title: p.title, icon: p.icon, databaseId: p.databaseId, parentId: p.parentId };
    }),
  );
  const descendantCount = usePageStore((s) => countPageDescendants(pageId, s.pages));
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);
  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const fullWidth = pageFullWidthById[pageId] ?? globalFullWidth;
  // 블록 댓글(우측 스레드)이 있을 때만 에디터 컬럼과 동일하게 우측 거터 예약.
  // 페이지 레벨 댓글(PAGE_COMMENT_SENTINEL)은 PageCommentBar 인라인 → Editor 와 동일 기준.
  const hasPageComments = useBlockCommentStore((s) =>
    s.messages.some(
      (m) =>
        m.pageId === pageId && m.blockId !== PAGE_COMMENT_SENTINEL,
    ),
  );
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const [iconAlert, setIconAlert] = useState<string | null>(null);
  const [tailSpacerPx, setTailSpacerPx] = useState(240);
  const subpagePopover = useAnchoredPopover(280);

  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, pageId]);

  useLayoutEffect(() => {
    const run = (): void => {
      setTailSpacerPx(computeEditorTailSpacerPx());
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
    return (
      <div className="p-8 text-sm text-zinc-500">
        행 페이지를 찾을 수 없습니다.
      </div>
    );
  }

  // Editor.tsx data-qn-editor-column 과 동일 — 속성 패널·헤더 폭이 본문과 일치하도록
  const columnClass = getEditorColumnClass({ fullWidth, hasPageComments });

  return (
    <div className="py-8">
      <div className={`mx-auto w-full ${columnClass}`}>
        <div className="px-12">
          <div className="mb-4">
            <PageTitleBar
              pageId={pageId}
              icon={page.icon}
              titleDraft={titleDraft}
              titleClassName="min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400"
              onTitleChange={(v) => setTitleDraft(v)}
              onTitleBlur={() => renamePage(pageId, titleDraft.trim() || "제목 없음")}
              onTitleKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onIconChange={(icon) => setIcon(pageId, icon)}
              onIconUploadMessage={(msg) => setIconAlert(msg)}
              defaultIcon={<FileText size={56} className="text-zinc-400" />}
              showSubpageTree={descendantCount > 0 || !!page.parentId}
              subpagePopover={subpagePopover}
            />
          </div>

          <DbPropertySection databaseId={databaseId} pageId={pageId} className="mt-3" />
          <PageCommentBar pageId={pageId} />
        </div>
      </div>

      <Editor pageId={pageId} bodyOnly showTailSpacer={false} />
      {subpagePopover.open && subpagePopover.coords && createPortal(
        <div
          ref={subpagePopover.popoverRef}
          style={{ position: "fixed", top: subpagePopover.coords.top, left: subpagePopover.coords.left, width: 280, zIndex: 9999 }}
          className="rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <PageSubpageTree currentPageId={pageId} className="px-2 pb-3 pt-1" hideHeader />
        </div>,
        document.body,
      )}
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
    </div>
  );
}
