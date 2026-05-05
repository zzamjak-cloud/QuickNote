import { GROUP_OVERLAY_ID } from "./constants";

export function isGroupOverlayTarget(target: Element): boolean {
  return Boolean(target.closest(`#${GROUP_OVERLAY_ID}`));
}
