type TemplatePageTitleChangeHandler = (
  databaseId: string,
  pageId: string,
  title: string,
) => void;

let templatePageTitleChangeHandler: TemplatePageTitleChangeHandler | null = null;

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
