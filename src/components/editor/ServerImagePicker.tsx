// 서버에 이미 업로드된 자산(이미지 / 동영상) 을 파일명으로 검색해 페이지에 삽입한다.
// /이미지검색 → 이미지 모드 (quicknote-image:// → image 노드).
// /동영상검색 → 동영상 모드 (quicknote-file://  → fileBlock 노드, mime=video/*).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Loader2, Search, X } from "lucide-react";
import { listMyAssetsApi } from "../../lib/sync/assetApi";
import type { GqlAsset } from "../../lib/sync/graphql/operations";
import { imageUrlCache } from "../../lib/images/registry";
import { insertBlockSmart } from "../../lib/editor/insertBlockSmart";
import { IMAGE_SCHEME } from "../../lib/sync/imageScheme";
import { FILE_SCHEME } from "../../lib/files/scheme";

export type ServerAssetPickerMode = "image" | "video";

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  mode: ServerAssetPickerMode;
};

const MODE_CONFIG: Record<
  ServerAssetPickerMode,
  { title: string; mimePrefix: string; placeholder: string; emptyHint: string }
> = {
  image: {
    title: "사용 안 된 이미지 검색",
    mimePrefix: "image/",
    placeholder: "파일명·ID 일부 입력",
    emptyHint: "사용 안 된 이미지가 없습니다.",
  },
  video: {
    title: "사용 안 된 동영상 검색",
    mimePrefix: "video/",
    placeholder: "파일명·ID 일부 입력",
    emptyHint: "사용 안 된 동영상이 없습니다.",
  },
};

function normalizeSearchText(s: string | null | undefined): string {
  if (!s) return "";
  // NFKC 정규화로 전각·반각, 조합 한글 통일. 이후 소문자만. 구분자는 그대로 둔다.
  // (이전 버전은 _-./ 를 공백으로 바꿔 토큰 분할하는 바람에 "asset_001.png" 처럼 구분자 포함 문자열을
  //  그대로 검색창에 붙여 넣었을 때 매칭이 깨졌다.)
  return s.normalize("NFKC").toLowerCase();
}

export function ServerImagePicker({ open, onClose, editor, mode }: Props) {
  const cfg = MODE_CONFIG[mode];
  const [assets, setAssets] = useState<GqlAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 입력 빠른 연속 변경에 따른 매 keystroke 리렌더 비용을 줄여 체감 지연 제거.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 자산이 페이지당 500개 한도라, 그 너머 항목은 검색해도 안 보이는 회귀가 있다.
      // nextToken 으로 끝까지 페이지를 이어 받아 전부 누적한다 (안전망: 50 페이지 = 25,000건 한도).
      const all: GqlAsset[] = [];
      let nextToken: string | null = null;
      let pages = 0;
      do {
        const res = await listMyAssetsApi({
          sortBy: "CREATED_AT_DESC",
          filterMimePrefix: cfg.mimePrefix,
          // 이미 다른 페이지에서 쓰이고 있는 자산은 제외해 리스트를 짧게 유지한다.
          // 사용 의도가 "어디에도 안 붙어 있는 자산을 재활용" 이므로 picker 에서는 unused 만 노출.
          filterUnusedOnly: true,
          limit: 500,
          ...(nextToken ? { nextToken } : {}),
        });
        for (const it of res.items) all.push(it);
        nextToken = res.nextToken ?? null;
        pages += 1;
        if (pages >= 50) break;
      } while (nextToken);
      setAssets(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [cfg.mimePrefix]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 검색 대상: 이름 · MIME · ID 를 합친 문자열에서 단순 부분일치(substring).
  // 토큰 분할은 하지 않는다 — 자산 관리 탭에서 파일명을 그대로 복사·붙여 넣어도 매칭되도록.
  const filtered = useMemo(() => {
    const q = normalizeSearchText(debouncedQuery).trim();
    if (!q) return assets;
    return assets.filter((a) => {
      const hay = normalizeSearchText(
        `${a.name ?? ""} ${a.mimeType ?? ""} ${a.id}`,
      );
      return hay.includes(q);
    });
  }, [assets, debouncedQuery]);

  const pick = (asset: GqlAsset) => {
    if (!editor) return;
    if (mode === "image") {
      insertBlockSmart(editor, {
        type: "image",
        attrs: {
          src: `${IMAGE_SCHEME}${asset.id}`,
          alt: asset.name ?? "",
        },
      });
    } else {
      insertBlockSmart(editor, {
        type: "fileBlock",
        attrs: {
          src: `${FILE_SCHEME}${asset.id}`,
          name: asset.name ?? null,
          size: asset.size ?? null,
          mime: asset.mimeType ?? null,
        },
      });
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[540] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[640px] max-w-[95vw] flex-col rounded-lg bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {cfg.title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={cfg.placeholder}
              className="h-8 w-full rounded border border-zinc-200 bg-white pl-7 pr-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && assets.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-zinc-500">
              <Loader2 className="animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-zinc-500">
              {query ? "검색 결과가 없습니다." : cfg.emptyHint}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {filtered.map((a) => (
                <ServerAssetTile
                  key={a.id}
                  asset={a}
                  mode={mode}
                  onPick={() => pick(a)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-zinc-200 px-4 py-2 text-right text-xs text-zinc-500 dark:border-zinc-700">
          {filtered.length} / {assets.length}개
        </div>
      </div>
    </div>
  );
}

function ServerAssetTile({
  asset,
  mode,
  onPick,
}: {
  asset: GqlAsset;
  mode: ServerAssetPickerMode;
  onPick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const tileRef = useRef<HTMLButtonElement | null>(null);
  // 가시 영역 진입 시에만 URL 을 요청 — 한 번에 수십 개 영상 metadata 가 동시에 로드되며
  // 메인 스레드가 점유돼 검색 입력이 반응하지 않던 회귀를 막는다.
  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;
    const cached = imageUrlCache.peek(asset.id);
    if (cached) {
      setUrl(cached);
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "120px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [asset.id]);
  useEffect(() => {
    if (!visible) return;
    if (url) return;
    let cancelled = false;
    void imageUrlCache.get(asset.id).then(
      (u) => {
        if (!cancelled) setUrl(u);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [visible, url, asset.id]);
  return (
    <button
      ref={tileRef}
      type="button"
      onClick={onPick}
      className="group flex flex-col overflow-hidden rounded border border-zinc-200 bg-zinc-50 text-left hover:border-blue-400 hover:bg-blue-50/40 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-blue-500/70 dark:hover:bg-blue-950/30"
      title={asset.name ?? asset.id}
    >
      <div className="grid aspect-square w-full place-items-center overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {url && mode === "image" ? (
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : url && mode === "video" ? (
          // 메타데이터만 로드해 첫 프레임을 썸네일로. #t=0.1 로 일부 브라우저에서 첫 프레임 강제 로드.
          <video
            src={`${url}#t=0.1`}
            className="h-full w-full object-cover"
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <Loader2 size={14} className="animate-spin text-zinc-400" />
        )}
      </div>
      <div className="truncate px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-200">
        {asset.name ?? asset.id.slice(0, 12)}
      </div>
    </button>
  );
}
