import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as LucideIcons from "lucide-react";
import { prepareIconImageForUpload } from "../../lib/images/compressImage";
import { uploadImage } from "../../lib/images/upload";
import { encodeLucidePageIcon, isImageLikePageIcon } from "../../lib/pageIcon";
import { PageIconDisplay } from "./PageIconDisplay";
import { type CustomIconPreset } from "../../lib/iconStorage";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useCustomIconStore } from "../../store/customIconStore";
import { pushRecentIcon } from "../../lib/recentIconStorage";

// 무거운 아이콘 카탈로그/패널은 picker 가 열릴 때만 지연 로드.
const IconPickerPanel = lazy(() =>
  import("./IconPickerPanel").then((m) => ({ default: m.IconPickerPanel })),
);

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_PICKER_PANEL_WIDTH = 320;
const ICON_PICKER_PANEL_ESTIMATED_HEIGHT = 440;
const ICON_PICKER_VIEWPORT_PADDING = 24;
const ICON_PICKER_BOTTOM_SAFE_PADDING = 72;

// file.arrayBuffer() 가 NotReadableError 로 실패할 때의 폴백 — FileReader 로 바이트를 읽는다.
function readFileViaReader(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("파일 읽기 실패"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("파일 읽기 실패"));
    reader.readAsArrayBuffer(file);
  });
}

type Props = {
  current: string | null;
  onChange: (icon: string | null) => void;
  // 인라인 컴팩트 모드: 사이드바·트리에서 작은 아이콘 버튼만 노출
  size?: "lg" | "md" | "sm";
  /** 이미지 업로드 실패·용량 초과 시 알림 */
  onUploadMessage?: (message: string) => void;
  /** current가 null일 때 표시할 기본 아이콘. 미지정 시 + 아이콘 */
  defaultIcon?: React.ReactNode;
  /** 외부 인라인 편집 UI가 picker 열림 상태에 따라 blur 처리를 조정할 때 사용. */
  onOpenChange?: (open: boolean) => void;
};

// 카테고리 탭 + 검색이 내장된 emoji-picker-react 기반 아이콘 picker.
export function IconPicker({
  current,
  onChange,
  size = "lg",
  onUploadMessage,
  defaultIcon,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const iconUploadSeqRef = useRef(0);
  // 워크스페이스 공유 커스텀 아이콘 — 모든 멤버가 같은 목록을 본다.
  // 서버 fetch 후 store 에 캐시, 페이지 첫 진입 시 1회 호출.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const customIconsByWs = useCustomIconStore((s) => s.byWorkspace);
  const fetchCustomIcons = useCustomIconStore((s) => s.fetch);
  const addCustomIconSrv = useCustomIconStore((s) => s.add);
  const removeCustomIconSrv = useCustomIconStore((s) => s.remove);
  // 업로드/등록 진행 상태 — 사용자에게 진행 중임을 시각적으로 알리는 용도.
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const customIcons: CustomIconPreset[] = useMemo(() => {
    if (!workspaceId) return [];
    return (customIconsByWs[workspaceId] ?? []).map((i) => ({
      id: i.id,
      src: i.src,
      label: i.label || "커스텀 아이콘",
    }));
  }, [customIconsByWs, workspaceId]);

  const setPickerOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchCustomIcons(workspaceId);
  }, [workspaceId, fetchCustomIcons]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      // 업로드 진행 중에는 외부 클릭으로 닫히지 않게 막아 진행 표시를 유지.
      if (uploadStatus) return;
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, setPickerOpen, uploadStatus]);

  const computePopoverCoords = useCallback((width: number, height: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const minLeft = viewportLeft + ICON_PICKER_VIEWPORT_PADDING;
    const maxLeft = viewportLeft + viewportWidth - width - ICON_PICKER_VIEWPORT_PADDING;
    const left = Math.max(minLeft, Math.min(rect.left, maxLeft));
    const belowTop = rect.bottom + 4;
    const aboveTop = rect.top - height - 4;
    const minTop = viewportTop + ICON_PICKER_VIEWPORT_PADDING;
    const maxTop = viewportTop + viewportHeight - height - ICON_PICKER_BOTTOM_SAFE_PADDING;
    const preferredTop =
      belowTop + height <= viewportTop + viewportHeight - ICON_PICKER_BOTTOM_SAFE_PADDING
        ? belowTop
        : aboveTop;
    const top = Math.max(minTop, Math.min(preferredTop, Math.max(minTop, maxTop)));
    return { top, left };
  }, []);

  const openPicker = () => {
    if (open) { setPickerOpen(false); return; }
    const coords = computePopoverCoords(ICON_PICKER_PANEL_WIDTH, ICON_PICKER_PANEL_ESTIMATED_HEIGHT);
    if (coords) setPopoverCoords(coords);
    setPickerOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => {
      const width = panel.offsetWidth || ICON_PICKER_PANEL_WIDTH;
      const height = panel.offsetHeight || ICON_PICKER_PANEL_ESTIMATED_HEIGHT;
      const next = computePopoverCoords(width, height);
      if (next) {
        setPopoverCoords((prev) =>
          prev && Math.abs(prev.top - next.top) < 1 && Math.abs(prev.left - next.left) < 1
            ? prev
            : next,
        );
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [computePopoverCoords, open]);

  const trigger =
    size === "lg" ? (
      <button
        type="button"
        onClick={openPicker}
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md text-5xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="lg" />
        ) : (
          defaultIcon ?? <LucideIcons.Plus size={18} className="text-zinc-400" />
        )}
      </button>
    ) : size === "md" ? (
      <button
        type="button"
        onClick={openPicker}
        className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="md" />
        ) : (
          defaultIcon ?? <PageIconDisplay icon={null} size="md" />
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={openPicker}
        className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ? (
          <PageIconDisplay icon={current} size="sm" />
        ) : (
          defaultIcon ?? <PageIconDisplay icon={null} size="sm" />
        )}
      </button>
    );

  const onPickImageFile = async (file: File | undefined, savePreset = true) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > MAX_ICON_BYTES) {
      onUploadMessage?.(`아이콘 이미지는 ${(MAX_ICON_BYTES / 1024 / 1024).toFixed(0)}MB 이하만 가능합니다 (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB).`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const uploadSeq = iconUploadSeqRef.current + 1;
    iconUploadSeqRef.current = uploadSeq;
    const previousIcon = current ?? null;
    const previewUrl = URL.createObjectURL(file);
    onChange(previewUrl);
    setPickerOpen(false);
    setUploadStatus(null);
    if (fileRef.current) fileRef.current.value = "";

    void (async () => {
      try {
        // 파일 바이트를 비동기 처리 전에 메모리로 즉시 스냅샷해 안정적인 File 로 대체.
        // 클라우드 동기화(iCloud/Dropbox 미다운로드) 나 쓰기 중 파일은 arrayBuffer 가 NotReadableError 를
        // 던질 수 있어, 짧은 지연으로 재시도 + FileReader 폴백까지 시도한다.
        let buf: ArrayBuffer | null = null;
        for (let attempt = 0; attempt < 3 && buf === null; attempt += 1) {
          try {
            buf = await file.arrayBuffer();
          } catch {
            buf = await readFileViaReader(file).catch(() => null);
          }
          if (buf === null && attempt < 2) await new Promise((r) => setTimeout(r, 150));
        }
        if (buf === null) {
          if (iconUploadSeqRef.current === uploadSeq) onChange(previousIcon);
          onUploadMessage?.(
            "파일을 읽지 못했습니다. 클라우드(iCloud/Dropbox) 동기화가 끝났는지 확인하거나, 파일을 다른 위치로 복사한 뒤 다시 시도해 주세요.",
          );
          return;
        }
        const safeFile = new File([buf], file.name || "icon", {
          type: file.type || "image/png",
        });
        const prepared = await prepareIconImageForUpload(safeFile);
        const src = await uploadImage(prepared, { compressed: true });
        if (iconUploadSeqRef.current !== uploadSeq) return;
        onChange(src);
        if (savePreset && workspaceId) {
          try {
            await addCustomIconSrv({
              workspaceId,
              src,
              label: file.name || "커스텀 아이콘",
            });
          } catch (err) {
            console.error("[IconPicker] addCustomIcon 실패", err);
            onUploadMessage?.("아이콘 등록은 실패했지만 페이지에는 적용되었습니다.");
          }
        }
      } catch (err) {
        console.error("[IconPicker] uploadCustomIcon background 실패", err);
        if (iconUploadSeqRef.current === uploadSeq) onChange(previousIcon);
        onUploadMessage?.("아이콘 등록에 실패했습니다.");
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
      }
    })();
  };

  // 노션 가져오기 등으로 들어온 이미지 아이콘은 커스텀 아이콘 라이브러리에 없어 재사용이 어렵다.
  // 현재 아이콘이 이미지이고 아직 등록되지 않았다면 "커스텀 아이콘 등록" 버튼을 노출한다.
  const canRegisterCurrent =
    !!workspaceId &&
    isImageLikePageIcon(current) &&
    !customIcons.some((icon) => icon.src === current);

  const registerCurrentAsCustomIcon = async () => {
    if (!workspaceId || !current) return;
    setUploadStatus("아이콘 등록 중…");
    try {
      await addCustomIconSrv({ workspaceId, src: current, label: "커스텀 아이콘" });
      onUploadMessage?.("현재 아이콘을 커스텀 아이콘으로 등록했습니다.");
    } catch (err) {
      console.error("[IconPicker] 현재 아이콘 커스텀 등록 실패", err);
      onUploadMessage?.("커스텀 아이콘 등록에 실패했습니다.");
    } finally {
      setUploadStatus(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {trigger}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickImageFile(e.target.files?.[0])}
      />
      {open && popoverCoords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: popoverCoords.top, left: popoverCoords.left, zIndex: 9999 }}
        >
          <Suspense fallback={null}>
            <IconPickerPanel
              onPickLucide={(name, nextColor) => {
                iconUploadSeqRef.current += 1;
                const encoded = encodeLucidePageIcon(name, nextColor);
                pushRecentIcon(encoded);
                onChange(encoded);
                setPickerOpen(false);
              }}
              onPickEmoji={(emoji) => {
                iconUploadSeqRef.current += 1;
                pushRecentIcon(emoji);
                onChange(emoji);
                setPickerOpen(false);
              }}
              onPickCustom={(icon) => {
                iconUploadSeqRef.current += 1;
                pushRecentIcon(icon);
                onChange(icon);
                setPickerOpen(false);
              }}
              onRequestCustomUpload={() => fileRef.current?.click()}
              customIcons={customIcons}
              onDeleteCustomIcon={(id) => {
                if (!workspaceId) return;
                void removeCustomIconSrv(id, workspaceId).catch((err) => {
                  console.error("[IconPicker] deleteCustomIcon 실패", err);
                });
              }}
              footer={
                <>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!uploadStatus}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-progress disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {uploadStatus ? (
                      <LucideIcons.Loader2 size={14} className="shrink-0 animate-spin text-blue-500" />
                    ) : (
                      <LucideIcons.ImagePlus size={14} className="shrink-0 text-zinc-500" />
                    )}
                    {uploadStatus ?? "이미지 업로드"}
                  </button>
                  {canRegisterCurrent ? (
                    <button
                      type="button"
                      onClick={() => void registerCurrentAsCustomIcon()}
                      disabled={!!uploadStatus}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-progress disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <LucideIcons.BookmarkPlus size={14} className="shrink-0 text-zinc-500" />
                      커스텀 아이콘 등록
                    </button>
                  ) : null}
                  {current ? (
                    <button
                      type="button"
                      onClick={() => {
                        iconUploadSeqRef.current += 1;
                        onChange(null);
                        setPickerOpen(false);
                      }}
                      className="group flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <div className="h-5 w-5 shrink-0 overflow-hidden rounded opacity-70 group-hover:opacity-100">
                        <PageIconDisplay icon={current} size="sm" />
                      </div>
                      <span>아이콘 제거</span>
                    </button>
                  ) : null}
                </>
              }
            />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  );
}
