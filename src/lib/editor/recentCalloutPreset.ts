// 콜아웃 블록을 새로 만들 때 마지막으로 사용한 프리셋을 기억한다(localStorage).
import {
  CALLOUT_PRESET_MAP,
  type CalloutPresetId,
} from "../tiptapExtensions/calloutPresets";

const LS_KEY = "qn.recentCalloutPreset.v1";
const DEFAULT_PRESET: CalloutPresetId = "idea";

export function getRecentCalloutPreset(): CalloutPresetId {
  try {
    const v = localStorage.getItem(LS_KEY);
    // 저장값이 알려진 프리셋일 때만 사용(스키마 변경·손상 방어).
    if (v && v in CALLOUT_PRESET_MAP) return v as CalloutPresetId;
  } catch {
    /* noop */
  }
  return DEFAULT_PRESET;
}

export function setRecentCalloutPreset(preset: CalloutPresetId): void {
  try {
    localStorage.setItem(LS_KEY, preset);
  } catch {
    /* noop */
  }
}
