export const PUBLIC_OUTLINE_SIDEBAR_WIDTH_CLASS =
  "w-[min(20rem,calc(100vw-2rem))] md:w-80";

export function getPublicViewerShellClassName(outlineOpen: boolean): string {
  return [
    "h-dvh overflow-y-auto bg-white transition-[padding-right] duration-200 ease-out dark:bg-zinc-950",
    outlineOpen ? "md:pr-80" : "md:pr-0",
  ].join(" ");
}
