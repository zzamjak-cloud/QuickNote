import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useShallow } from "zustand/react/shallow";
import { useDatabaseStore } from "../../store/databaseStore";
import { Editor } from "../editor/Editor";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageCommentBar } from "../comments/PageCommentBar";
import { computeEditorTailSpacerPx } from "../editor/editorHelpers";
import { PageSubpageTree } from "../page/PageSubpageTree";
import { countPageDescendants } from "../page/pageSubpageTreeUtils";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
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

  return (
    <div>
      <Editor
        pageId={pageId}
        bodyOnly
        showTailSpacer={false}
        bodyPrefix={
          <div className="px-12 pt-8">
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
        }
      />
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
