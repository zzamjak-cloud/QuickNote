import { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react";
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { PageIconDisplay } from "../../components/common/PageIconDisplay";
import { encodeLucidePageIcon } from "../pageIcon";
import { CALLOUT_PRESET_MAP, type CalloutPresetId } from "./calloutPresets";

// 무거운 아이콘 카탈로그/패널은 picker 가 열릴 때만 지연 로드.
const IconPickerPanel = lazy(() =>
  import("../../components/common/IconPickerPanel").then((m) => ({
    default: m.IconPickerPanel,
  })),
);

export function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const presetId = (node.attrs.preset as CalloutPresetId) ?? "idea";
  const customEmoji = node.attrs.emoji as string | null;
  const def = CALLOUT_PRESET_MAP[presetId] ?? CALLOUT_PRESET_MAP.idea;

  // 사용자 지정 아이콘 우선, 없으면 프리셋 기본 이모지
  const displayEmoji = customEmoji || def.emoji || null;
  const hasEmoji = !!displayEmoji;

  const colorStyle = def.color
    ? { background: def.color, borderColor: def.color }
    : undefined;

  const handlePickEmoji = useCallback(
    (emoji: string) => {
      updateAttributes({ emoji });
      setPickerOpen(false);
    },
    [updateAttributes],
  );

  const handlePickLucide = useCallback(
    (name: string, color: string) => {
      updateAttributes({ emoji: encodeLucidePageIcon(name, color) });
      setPickerOpen(false);
    },
    [updateAttributes],
  );

  // 피커 외부 클릭 시 닫기
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        pickerRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      )
        return;
      setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  return (
    <NodeViewWrapper className="relative w-full">
      <div
        data-callout=""
        data-preset={presetId}
        className={[
          "flex items-start gap-3 rounded-xl px-4 py-3",
          def.frameClass,
        ].join(" ")}
        style={colorStyle}
      >
        {/* 박스 내부 좌측 상단 아이콘 */}
        {hasEmoji && (
          <button
            ref={btnRef}
            type="button"
            contentEditable={false}
            suppressContentEditableWarning
            className="mt-0.5 shrink-0 cursor-pointer select-none rounded-lg p-1 transition hover:bg-black/10 dark:hover:bg-white/10"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="아이콘 변경"
          >
            <PageIconDisplay
              icon={displayEmoji}
              size="lg"
              className="text-[1.8rem] leading-none drop-shadow-md"
            />
          </button>
        )}

        {/* 본문 편집 영역 */}
        <NodeViewContent
          className="callout-body min-w-0 flex-1"
          data-callout-body=""
        />
      </div>

      {/* 아이콘 피커 패널 */}
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="absolute left-0 top-0 z-50"
          contentEditable={false}
          suppressContentEditableWarning
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Suspense fallback={null}>
            <IconPickerPanel
              onPickEmoji={handlePickEmoji}
              onPickLucide={handlePickLucide}
            />
          </Suspense>
        </div>
      )}
    </NodeViewWrapper>
  );
}
