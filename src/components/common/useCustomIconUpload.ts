// 슬래시 "이모지" 아이콘 picker 등 IconPicker 래퍼 밖에서 커스텀 아이콘
// (이미지 업로드/등록/삭제/목록)을 재사용하기 위한 훅.
//
// page-icon 경로의 IconPicker 래퍼는 onChange/current 기반 미리보기·롤백
// 시맨틱과 강하게 결합돼 있어 그대로 둔다. 이 훅은 그 결합 없이 "파일을
// 업로드해 src 를 돌려주고, 커스텀 아이콘으로 서버 등록"하는 순수 동작만 제공한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { prepareIconImageForUpload } from "../../lib/images/compressImage";
import { uploadImage } from "../../lib/images/upload";
import type { CustomIconPreset } from "../../lib/iconStorage";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useCustomIconStore } from "../../store/customIconStore";

const MAX_ICON_BYTES = 5 * 1024 * 1024;

// 클라우드 미다운로드/쓰기 중 파일에서 arrayBuffer 가 실패할 때의 폴백.
function readFileViaReader(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

type Options = {
  /** 업로드 실패/용량 초과 등 사용자 안내 메시지. */
  onMessage?: (msg: string) => void;
};

type Result = {
  /** 현재 워크스페이스의 커스텀 아이콘 목록. */
  customIcons: CustomIconPreset[];
  /** 업로드 진행 여부. */
  uploading: boolean;
  /**
   * 이미지 파일을 업로드하고 커스텀 아이콘으로 서버 등록한 뒤 src 를 반환한다.
   * 실패 시 null 을 반환하고 onMessage 로 안내한다.
   */
  uploadIconFile: (file: File | undefined | null) => Promise<string | null>;
  /** 커스텀 아이콘 삭제 (서버 동기화). */
  deleteCustomIcon: (id: string) => void;
};

export function useCustomIconUpload({ onMessage }: Options = {}): Result {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const customIconsByWs = useCustomIconStore((s) => s.byWorkspace);
  const fetchCustomIcons = useCustomIconStore((s) => s.fetch);
  const addCustomIconSrv = useCustomIconStore((s) => s.add);
  const removeCustomIconSrv = useCustomIconStore((s) => s.remove);
  const [uploading, setUploading] = useState(false);

  const customIcons: CustomIconPreset[] = useMemo(() => {
    if (!workspaceId) return [];
    return (customIconsByWs[workspaceId] ?? []).map((i) => ({
      id: i.id,
      src: i.src,
      label: i.label || "커스텀 아이콘",
    }));
  }, [customIconsByWs, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void fetchCustomIcons(workspaceId);
  }, [workspaceId, fetchCustomIcons]);

  const uploadIconFile = useCallback(
    async (file: File | undefined | null): Promise<string | null> => {
      if (!file || !file.type.startsWith("image/")) return null;
      if (file.size > MAX_ICON_BYTES) {
        onMessage?.(
          `아이콘 이미지는 ${(MAX_ICON_BYTES / 1024 / 1024).toFixed(0)}MB 이하만 가능합니다 (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
        );
        return null;
      }
      setUploading(true);
      try {
        // 비동기 처리 전에 파일 바이트를 즉시 스냅샷해 안정적인 File 로 대체.
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
          onMessage?.(
            "파일을 읽지 못했습니다. 클라우드(iCloud/Dropbox) 동기화가 끝났는지 확인하거나, 파일을 다른 위치로 복사한 뒤 다시 시도해 주세요.",
          );
          return null;
        }
        const safeFile = new File([buf], file.name || "icon", {
          type: file.type || "image/png",
        });
        const prepared = await prepareIconImageForUpload(safeFile);
        const src = await uploadImage(prepared, { compressed: true });
        if (workspaceId) {
          try {
            await addCustomIconSrv({
              workspaceId,
              src,
              label: file.name || "커스텀 아이콘",
            });
          } catch (err) {
            console.error("[useCustomIconUpload] addCustomIcon 실패", err);
            onMessage?.("아이콘 등록은 실패했지만 삽입에는 사용됩니다.");
          }
        }
        return src;
      } catch (err) {
        console.error("[useCustomIconUpload] 업로드 실패", err);
        onMessage?.("아이콘 업로드에 실패했습니다.");
        return null;
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, addCustomIconSrv, onMessage],
  );

  const deleteCustomIcon = useCallback(
    (id: string) => {
      if (!workspaceId) return;
      void removeCustomIconSrv(id, workspaceId).catch((err) => {
        console.error("[useCustomIconUpload] deleteCustomIcon 실패", err);
      });
    },
    [workspaceId, removeCustomIconSrv],
  );

  return { customIcons, uploading, uploadIconFile, deleteCustomIcon };
}
