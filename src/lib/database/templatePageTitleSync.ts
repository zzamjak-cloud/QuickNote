type TemplatePageTitleChangeHandler = (
  databaseId: string,
  pageId: string,
  title: string,
) => void;
type TemplatePageMarkerReconcileHandler = (databaseId: string) => void;

let templatePageTitleChangeHandler: TemplatePageTitleChangeHandler | null = null;
let templatePageMarkerReconcileHandler: TemplatePageMarkerReconcileHandler | null = null;

export function registerTemplatePageTitleChangeHandler(
  handler: TemplatePageTitleChangeHandler,
): () => void {
  templatePageTitleChangeHandler = handler;
  return () => {
    if (templatePageTitleChangeHandler === handler) {
      templatePageTitleChangeHandler = null;
    }
  };
}

export function notifyTemplatePageTitleChanged(
  databaseId: string,
  pageId: string,
  title: string,
): void {
  templatePageTitleChangeHandler?.(databaseId, pageId, title);
}

export function registerTemplatePageMarkerReconcileHandler(
  handler: TemplatePageMarkerReconcileHandler,
): () => void {
  templatePageMarkerReconcileHandler = handler;
  return () => {
    if (templatePageMarkerReconcileHandler === handler) {
      templatePageMarkerReconcileHandler = null;
    }
  };
}

export function reconcileTemplatePageMarkers(databaseId: string): void {
  templatePageMarkerReconcileHandler?.(databaseId);
}
