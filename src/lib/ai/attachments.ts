// AI 채팅 첨부 처리 — 이미지 리사이즈·재인코딩(base64), 텍스트 문서 읽기, 멘션 페이지 조립.
// 서버 상한(메시지 32K자·이미지 3M b64/장·총 5M)과 맞물리는 클라이언트측 예산을 관리한다.

import { usePageStore } from "../../store/pageStore";
import { ensurePageContentLoaded } from "../sync/pageContentLoad";
import { pageDocToMarkdown } from "../export/pageToMarkdown";

export type PendingImageAttachment = {
  kind: "image";
  name: string;
  mimeType: string;
  dataBase64: string;
  /** 말풍선 썸네일용 data URL */
  previewUrl: string;
};

export type PendingTextAttachment = {
  kind: "text";
  name: string;
  text: string;
};

export type PendingAttachment = PendingImageAttachment | PendingTextAttachment;

export const MAX_ATTACHED_IMAGES = 4;
/** 이미지 긴 변 상한(px) — 멀티모달 입력 권장 해상도 수준으로 축소해 페이로드 절약. */
const IMAGE_MAX_DIMENSION = 1568;
/** 장당 base64 상한 — 서버(3M)보다 여유 있게. */
const IMAGE_MAX_B64 = 2_500_000;
/** 텍스트 문서 첨부당 문자 상한 — 서버 메시지 상한(32K) 내 배분. */
export const TEXT_ATTACHMENT_MAX_CHARS = 12_000;
/** 멘션 페이지당 본문 상한. */
export const MENTION_PAGE_MAX_CHARS = 8_000;
export const MAX_MENTION_PAGES = 5;
/** 조립된 user 메시지 총 상한 — 서버 MAX_MESSAGE_CHARS(32K) 이내. */
const ASSEMBLED_MESSAGE_MAX_CHARS = 30_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "log", "xml", "yml", "yaml", "html",
]);

export function isSupportedImageFile(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type);
}

export function isSupportedTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * 이미지 파일 → 첨부. 긴 변 상한으로 축소 후 JPEG 재인코딩(작은 파일은 원본 유지).
 * GIF 는 애니메이션 보존을 위해 축소 없이 원본 사용(크면 거부).
 */
export async function prepareImageAttachment(file: File): Promise<PendingImageAttachment> {
  const originalDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지 읽기 실패"));
    reader.readAsDataURL(file);
  });

  const passthrough = (): PendingImageAttachment => ({
    kind: "image",
    name: file.name || "이미지",
    mimeType: file.type,
    dataBase64: dataUrlToBase64(originalDataUrl),
    previewUrl: originalDataUrl,
  });

  if (file.type === "image/gif") {
    const att = passthrough();
    if (att.dataBase64.length > IMAGE_MAX_B64) throw new Error("GIF 가 너무 큽니다 (최대 약 1.8MB)");
    return att;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지 디코딩 실패"));
    el.src = originalDataUrl;
  });

  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  // 충분히 작으면 원본 그대로 (PNG 투명도 등 보존)
  if (longEdge <= IMAGE_MAX_DIMENSION && dataUrlToBase64(originalDataUrl).length <= IMAGE_MAX_B64) {
    return passthrough();
  }

  const scale = Math.min(1, IMAGE_MAX_DIMENSION / longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 처리 실패");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // JPEG 품질을 낮춰가며 상한 내로
  for (const quality of [0.85, 0.7, 0.55]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const b64 = dataUrlToBase64(dataUrl);
    if (b64.length <= IMAGE_MAX_B64) {
      return {
        kind: "image",
        name: file.name || "이미지",
        mimeType: "image/jpeg",
        dataBase64: b64,
        previewUrl: dataUrl,
      };
    }
  }
  throw new Error("이미지가 너무 큽니다");
}

/** 텍스트 문서 파일 → 첨부 (상한 초과분 절단 고지). */
export async function prepareTextAttachment(file: File): Promise<PendingTextAttachment> {
  const raw = await file.text();
  const text =
    raw.length > TEXT_ATTACHMENT_MAX_CHARS
      ? `${raw.slice(0, TEXT_ATTACHMENT_MAX_CHARS)}\n…(문서가 길어 이후 생략됨)`
      : raw;
  return { kind: "text", name: file.name || "문서", text };
}

/**
 * 전송용 user 메시지 조립 — 본문 텍스트 + 텍스트 문서 + 멘션 페이지 본문.
 * 멘션 페이지는 필요 시 서버에서 로드(lazy). 총 상한 초과분은 절단 고지.
 */
export async function assembleUserMessage(args: {
  text: string;
  mentions: Array<{ pageId: string; title: string }>;
  textAttachments: PendingTextAttachment[];
}): Promise<string> {
  const blocks: string[] = [args.text];

  for (const att of args.textAttachments) {
    blocks.push(`[첨부 문서: ${att.name}]\n${att.text}\n[첨부 문서 끝]`);
  }

  const mentions = args.mentions.slice(0, MAX_MENTION_PAGES);
  for (const m of mentions) {
    await ensurePageContentLoaded({ pageId: m.pageId, source: "ai-mention" }).catch(() => false);
    const page = usePageStore.getState().pages[m.pageId];
    if (!page) {
      blocks.push(`[참고 페이지 "${m.title}" 를 불러오지 못함]`);
      continue;
    }
    let body = page.doc
      ? pageDocToMarkdown(page.doc, {
          renderDatabaseBlock: () => "[인라인 DB 생략]",
        }).trim()
      : "";
    if (body.length > MENTION_PAGE_MAX_CHARS) {
      body = `${body.slice(0, MENTION_PAGE_MAX_CHARS)}\n…(본문이 길어 이후 생략됨)`;
    }
    const title = page.title?.trim() || m.title || "제목 없음";
    blocks.push(`[참고 페이지: ${title}]\n${body || "(본문 없음)"}\n[참고 페이지 끝]`);
  }

  if (mentions.length > 0 || args.textAttachments.length > 0) {
    blocks.push(
      "위 [첨부 문서]/[참고 페이지] 블록들은 사용자가 이 질문의 참고 자료로 첨부한 것이다. 답변 시 근거로 활용하라.",
    );
  }

  let assembled = blocks.join("\n\n");
  if (assembled.length > ASSEMBLED_MESSAGE_MAX_CHARS) {
    assembled = `${assembled.slice(0, ASSEMBLED_MESSAGE_MAX_CHARS)}\n…(첨부 내용이 길어 이후 생략됨)`;
  }
  return assembled;
}
