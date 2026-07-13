// AI 채팅 사이드 패널 — 페이지 컨텍스트 기반 대화 + @페이지 멘션·문서/이미지 첨부.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Check,
  CircleStop,
  Copy,
  Eraser,
  FileText,
  ChevronDown,
  FileStack,
  Languages,
  ListTodo,
  Loader2,
  Paperclip,
  Replace,
  Send,
  Sparkles,
  TextCursorInput,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAiStore } from "../../store/aiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import {
  availableModels,
  defaultModelForProvider,
  providerForModel,
} from "../../lib/ai/models";
import {
  insertMarkdownAtCursor,
  replaceRangeWithMarkdown,
  replacePageWithMarkdown,
} from "../../lib/ai/insertToEditor";
import { translatePageInPlace } from "../../lib/ai/translateInPlace";
import {
  checklistMarkdownForInsert,
  looksLikeChecklist,
} from "../../lib/ai/extractChecklist";
import {
  isSupportedImageFile,
  isSupportedTextFile,
  prepareImageAttachment,
  prepareTextAttachment,
  MAX_ATTACHED_IMAGES,
  MAX_MENTION_PAGES,
  type PendingAttachment,
} from "../../lib/ai/attachments";
import { koreanMatchScore } from "../../lib/koreanSearch";

// 페이지 번역 대상 언어. name 은 프롬프트에 넘기는 한국어 언어명(모델이 이해), label 은 표시용.
const TRANSLATE_LANGUAGES: Array<{ name: string; label: string }> = [
  { name: "영어", label: "영어 (English)" },
  { name: "한국어", label: "한국어" },
  { name: "일본어", label: "일본어 (日本語)" },
  { name: "중국어 간체", label: "중국어 간체 (简体中文)" },
  { name: "중국어 번체", label: "중국어 번체 (繁體中文)" },
  { name: "스페인어", label: "스페인어 (Español)" },
  { name: "프랑스어", label: "프랑스어 (Français)" },
  { name: "독일어", label: "독일어 (Deutsch)" },
  { name: "러시아어", label: "러시아어 (Русский)" },
  { name: "포르투갈어", label: "포르투갈어 (Português)" },
  { name: "이탈리아어", label: "이탈리아어 (Italiano)" },
  { name: "베트남어", label: "베트남어 (Tiếng Việt)" },
  { name: "태국어", label: "태국어 (ไทย)" },
  { name: "인도네시아어", label: "인도네시아어 (Bahasa Indonesia)" },
  { name: "아랍어", label: "아랍어 (العربية)" },
  { name: "힌디어", label: "힌디어 (हिन्दी)" },
];

// AI 결과를 페이지에 반영하는 방식. 모두 미리보기 → 승인(적용) 단계를 거친다.
type ApplyMode = "insert" | "checklist" | "replaceSelection" | "replacePage";
const APPLY_LABELS: Record<ApplyMode, string> = {
  insert: "현재 커서 위치에 삽입",
  checklist: "체크리스트로 삽입",
  replaceSelection: "선택 영역 교체",
  replacePage: "페이지 전체 교체",
};

export function AiChatPanel() {
  const panelOpen = useAiStore((s) => s.panelOpen);
  const context = useAiStore((s) => s.context);
  const messages = useAiStore((s) => s.messages);
  const isStreaming = useAiStore((s) => s.isStreaming);
  const toolStatus = useAiStore((s) => s.toolStatus);
  const model = useAiStore((s) => s.model);
  const configByWorkspace = useAiStore((s) => s.configByWorkspace);
  const closePanel = useAiStore((s) => s.closePanel);
  const clearChat = useAiStore((s) => s.clearChat);
  const setModel = useAiStore((s) => s.setModel);
  const send = useAiStore((s) => s.send);
  const stop = useAiStore((s) => s.stop);
  const selectionRange = useAiStore((s) => s.selectionRange);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const activePageId = usePageStore((s) => s.activePageId);
  const showToast = useUiStore((s) => s.showToast);

  const updateContextOptions = useAiStore((s) => s.updateContextOptions);
  const [chipOpen, setChipOpen] = useState(false);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 적용 전 미리보기(제안 → 미리보기 → 승인 적용). null 이면 미리보기 닫힘.
  const [preview, setPreview] = useState<{ mode: ApplyMode; content: string } | null>(null);
  // 제자리 페이지 번역 진행 상태(대상 언어 라벨). null 이면 비활성.
  const [translating, setTranslating] = useState<string | null>(null);
  // 번역 언어 드롭다운 열림 여부.
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // @페이지 멘션 — 캐럿 앞 "@질의" 감지 → 팝업. null 이면 닫힘.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pendingMentions, setPendingMentions] = useState<
    Array<{ pageId: string; title: string }>
  >([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // 드래그앤드롭 — enter/leave 중첩을 카운터로 추적해 오버레이 표시
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const workspaceId = currentWorkspaceId ?? "";
  const wsConfig = workspaceId ? configByWorkspace[workspaceId] : undefined;
  const keyedProviders =
    wsConfig?.providers?.filter((p) => p.hasKey).map((p) => p.provider) ??
    (wsConfig?.hasKey && wsConfig.provider ? [wsConfig.provider] : []);
  const modelOptions = availableModels(keyedProviders);
  const defaultModel =
    wsConfig?.defaultModel && modelOptions.some((m) => m.id === wsConfig.defaultModel)
      ? wsConfig.defaultModel
      : (modelOptions[0]?.id ?? defaultModelForProvider(wsConfig?.provider));
  // 키 없는 제공사 모델이 persist 되어 있으면 기본 모델로 폴백
  const effectiveModel =
    model && modelOptions.some((m) => m.id === model) ? model : defaultModel;

  // 새 메시지·스트리밍 델타마다 하단 고정
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 패널을 연 뒤 다른 페이지로 이동하면 닫는다 — 컨텍스트가 화면과 어긋난 채 남는 것 방지.
  // (피크뷰 진입은 컨텍스트 페이지 ≠ 활성 페이지일 수 있어, "연 시점 이후의 변경"만 감지)
  const panelOpenedAtPageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!panelOpen) {
      panelOpenedAtPageRef.current = null;
      return;
    }
    if (panelOpenedAtPageRef.current === null) {
      panelOpenedAtPageRef.current = activePageId ?? "";
      return;
    }
    if ((activePageId ?? "") !== panelOpenedAtPageRef.current) closePanel();
  }, [panelOpen, activePageId, closePanel]);

  useEffect(() => {
    if (panelOpen) inputRef.current?.focus();
  }, [panelOpen]);

  // 멘션 후보 — 현재 워크스페이스 페이지 제목을 한글 검색으로 매칭 (팝업 열릴 때만 계산)
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || !workspaceId) return [];
    const q = mentionQuery.trim().toLowerCase();
    const pages = usePageStore.getState().pages;
    const list = Object.values(pages).filter(
      (p) => p.workspaceId === workspaceId && (p.title ?? "").trim(),
    );
    const scored = q
      ? list
          .map((p) => ({ p, s: koreanMatchScore(p.title.toLowerCase(), q) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
      : [...list].map((p) => ({ p, s: 0 })).sort((a, b) => b.p.updatedAt - a.p.updatedAt);
    return scored.slice(0, 8).map((x) => x.p);
  }, [mentionQuery, workspaceId]);

  if (!panelOpen) return null;

  const detectMentionQuery = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(before);
    setMentionQuery(m ? m[2]! : null);
    setMentionIndex(0);
  };

  const applyMention = (page: { id: string; title: string }) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    // 입력에서 "@질의" 부분 제거 후 칩으로 전환
    const before = input.slice(0, caret).replace(/(^|\s)@[^\s@]*$/, "$1");
    setInput(before + input.slice(caret));
    setPendingMentions((prev) =>
      prev.some((m) => m.pageId === page.id) || prev.length >= MAX_MENTION_PAGES
        ? prev
        : [...prev, { pageId: page.id, title: page.title?.trim() || "제목 없음" }],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  const addFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      try {
        if (isSupportedImageFile(file)) {
          const imageCount = pendingAttachments.filter((a) => a.kind === "image").length;
          if (imageCount >= MAX_ATTACHED_IMAGES) {
            showToast(`이미지는 최대 ${MAX_ATTACHED_IMAGES}장까지 첨부할 수 있습니다`);
            continue;
          }
          const att = await prepareImageAttachment(file);
          setPendingAttachments((prev) => [...prev, att]);
        } else if (isSupportedTextFile(file)) {
          const att = await prepareTextAttachment(file);
          setPendingAttachments((prev) => [...prev, att]);
        } else {
          showToast(`지원하지 않는 형식: ${file.name} (이미지·텍스트 문서만)`);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "첨부 처리에 실패했습니다");
      }
    }
  };

  const handleSend = () => {
    const hasExtras = pendingMentions.length > 0 || pendingAttachments.length > 0;
    if (!workspaceId || (!input.trim() && !hasExtras) || isStreaming) return;
    void send(workspaceId, input, {
      mentions: pendingMentions,
      attachments: pendingAttachments,
    });
    setInput("");
    setPendingMentions([]);
    setPendingAttachments([]);
    setMentionQuery(null);
  };

  // 응답을 문서로 — 삽입 대상은 선택 원본 페이지 > 컨텍스트 페이지 > 활성 페이지 순
  const insertTargetPageId = selectionRange?.pageId ?? context?.pageId ?? activePageId;
  // 미리보기에 렌더할 최종 마크다운(체크리스트는 변환 후 형태로 보여준다).
  const previewMarkdown = preview
    ? preview.mode === "checklist"
      ? checklistMarkdownForInsert(preview.content)
      : preview.content
    : "";
  // 승인 시 실제 반영. 모드별로 삽입/교체 함수를 호출한다.
  const confirmApply = () => {
    if (!preview) return;
    const { mode, content } = preview;
    if (mode === "replaceSelection") {
      if (selectionRange) {
        const ok = replaceRangeWithMarkdown(selectionRange.pageId, selectionRange, content);
        showToast(ok ? "선택 영역을 교체했습니다" : "문서가 변경되어 교체할 수 없습니다");
        // 같은 범위 중복 교체(범위 어긋남) 방지 — 성공 시 원본 범위를 비운다
        if (ok) useAiStore.setState({ selectionRange: null });
      }
    } else if (!insertTargetPageId) {
      showToast("적용할 페이지가 없습니다");
    } else if (mode === "insert") {
      const ok = insertMarkdownAtCursor(insertTargetPageId, content);
      showToast(ok ? "문서에 삽입했습니다" : "삽입할 위치를 찾지 못했습니다");
    } else if (mode === "checklist") {
      const ok = insertMarkdownAtCursor(insertTargetPageId, checklistMarkdownForInsert(content));
      showToast(ok ? "체크리스트로 삽입했습니다" : "삽입할 위치를 찾지 못했습니다");
    } else if (mode === "replacePage") {
      const ok = replacePageWithMarkdown(insertTargetPageId, content);
      showToast(ok ? "페이지 전체를 교체했습니다" : "페이지를 교체할 수 없습니다");
    }
    setPreview(null);
  };
  const handleCopy = (id: string, content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    });
  };

  // 페이지 제자리 번역 — 블럭 구조·이미지 유지, 텍스트와 캡션만 번역문으로 치환.
  const translateTargetPageId = context?.pageId ?? activePageId;
  const handleTranslatePage = async (targetLanguage: string, label: string) => {
    if (translating) return;
    if (!translateTargetPageId) {
      showToast("번역할 페이지가 없습니다");
      return;
    }
    if (!workspaceId) {
      showToast("워크스페이스를 찾을 수 없습니다");
      return;
    }
    // 번역은 항상 고속(빠름·저비용) 모델로 고정한다. 단, 키가 등록된 제공사 안에서 선택해
    // 키 없는 제공사로 바뀌지 않게 한다: 현재 모델의 제공사 > 키 있는 첫 제공사 > 워크스페이스 기본.
    const curProvider = providerForModel(effectiveModel);
    const translateProvider =
      curProvider && keyedProviders.includes(curProvider)
        ? curProvider
        : keyedProviders[0] ?? wsConfig?.provider;
    const translateModel = defaultModelForProvider(translateProvider);
    setTranslating(label);
    try {
      const res = await translatePageInPlace({
        pageId: translateTargetPageId,
        workspaceId,
        model: translateModel,
        targetLanguage,
      });
      if (res.ok) {
        if (res.applied === 0) {
          showToast("번역할 텍스트가 없습니다");
        } else if (res.failedSegments > 0) {
          showToast(`${label} 번역 완료 (${res.applied}곳, ${res.failedSegments}곳 실패)`);
        } else {
          showToast(`${label} 번역 완료 (${res.applied}곳)`);
        }
      } else {
        const msg: Record<string, string> = {
          "no-editor": "페이지 편집기를 찾지 못했습니다",
          "not-editable": "편집할 수 없는 페이지입니다",
          empty: "번역할 텍스트가 없습니다",
          failed: "번역에 실패했습니다. 다시 시도해 주세요",
          aborted: "번역을 취소했습니다",
        };
        showToast(msg[res.reason] ?? "번역에 실패했습니다");
      }
    } catch (e) {
      console.error("[ai] 페이지 번역 실패", e);
      showToast("번역 중 오류가 발생했습니다");
    } finally {
      setTranslating(null);
    }
  };

  const bubbleActionClass =
    "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  const hasDraggedFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <aside
      className="fixed inset-y-0 right-0 z-[400] flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl sm:w-[400px] dark:border-zinc-700 dark:bg-zinc-950"
      aria-label="AI 채팅 패널"
      onDragEnter={(e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        setIsDragOver(true);
      }}
      onDragOver={(e) => {
        if (!hasDraggedFiles(e)) return;
        // 에디터 등 뒤쪽 드롭 핸들러로 전파되지 않게 패널이 소비
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        if (!hasDraggedFiles(e)) return;
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragOver(false);
      }}
      onDrop={(e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = 0;
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) void addFiles(files);
      }}
    >
      {/* 드래그 중 드롭 안내 오버레이 */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-violet-50/80 dark:bg-violet-950/60">
          <div className="rounded-lg border-2 border-dashed border-violet-400 px-6 py-4 text-sm font-medium text-violet-700 dark:border-violet-500 dark:text-violet-300">
            여기에 놓아 첨부 (이미지·텍스트 문서)
          </div>
        </div>
      )}
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Sparkles size={16} className="shrink-0 text-violet-500" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">AI와 대화</h2>
        <button
          type="button"
          onClick={clearChat}
          disabled={isStreaming || messages.length === 0}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          aria-label="대화 지우기"
          title="대화 지우기"
        >
          <Eraser size={14} />
        </button>
        <button
          type="button"
          onClick={closePanel}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="AI 패널 닫기"
        >
          <X size={14} />
        </button>
      </header>

      {/* 페이지 제자리 번역 — 블럭 구조·이미지 유지, 텍스트·캡션만 번역. */}
      {translateTargetPageId && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <span className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Languages size={12} aria-hidden />
            페이지 번역
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangMenuOpen((v) => !v)}
              disabled={!!translating}
              className="flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
            >
              언어 선택
              <ChevronDown size={11} aria-hidden />
            </button>
            {langMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[9]"
                  onClick={() => setLangMenuOpen(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className="absolute left-0 top-full z-10 mt-1 max-h-64 w-44 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {TRANSLATE_LANGUAGES.map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setLangMenuOpen(false);
                        void handleTranslatePage(l.name, l.name);
                      }}
                      className="block w-full px-2.5 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {translating && (
            <span className="flex items-center gap-1 text-[11px] text-violet-500">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              {translating} 번역 중…
            </span>
          )}
        </div>
      )}

      {/* 컨텍스트 칩 — 포함 범위 가시화·조절 */}
      {context && (
        <div className="shrink-0 space-y-1.5 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {(context.parts?.length ? context.parts : [{ kind: "body" as const, title: context.label, chars: context.markdown.length }]).map(
              (part) => {
                const chipLabel =
                  part.kind === "database" && part.totalRows != null
                    ? `${part.title}(${part.includedRows ?? 0}/${part.totalRows}행)`
                    : part.title;
                // 조절할 것이 있는 컨텍스트(DB 채팅·인라인 DB 포함 페이지)만 클릭 가능
                const adjustable =
                  Boolean(context.databaseId) ||
                  (context.parts ?? []).some((p) => p.kind === "database");
                const chipClass =
                  "inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900";
                if (!adjustable) {
                  return (
                    <span
                      key={`${part.kind}-${part.id ?? part.title}`}
                      className={chipClass}
                      title="컨텍스트에 포함됨"
                    >
                      <FileText size={11} className="shrink-0" aria-hidden />
                      <span className="truncate">{chipLabel}</span>
                    </span>
                  );
                }
                return (
                  <button
                    key={`${part.kind}-${part.id ?? part.title}`}
                    type="button"
                    onClick={() => setChipOpen((o) => !o)}
                    className={`${chipClass} hover:border-violet-300 hover:bg-violet-50 dark:hover:border-violet-700 dark:hover:bg-violet-950/40`}
                    title="컨텍스트 범위 조절"
                  >
                    <FileText size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{chipLabel}</span>
                  </button>
                );
              },
            )}
            {context.truncated && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                내용이 많아 일부만 전달됨
              </span>
            )}
            {toolStatus && (
              <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {toolStatus}
              </span>
            )}
          </div>
          {/* 페이지 컨텍스트 — 인라인 DB 포함/제외 토글 */}
          {chipOpen && !context.databaseId && (
            <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
              {(context.parts ?? [])
                .filter((p) => p.kind === "database" && p.id)
                .map((part) => {
                  const excluded = new Set(context.options?.excludedDbIds ?? []);
                  return (
                    <label
                      key={part.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{part.title}</span>
                      <input
                        type="checkbox"
                        checked={!excluded.has(part.id!)}
                        disabled={isStreaming}
                        onChange={(e) => {
                          const next = new Set(context.options?.excludedDbIds ?? []);
                          if (e.target.checked) next.delete(part.id!);
                          else next.add(part.id!);
                          updateContextOptions({ excludedDbIds: [...next] });
                        }}
                      />
                    </label>
                  );
                })}
              <p className="text-[10px] text-zinc-400">
                체크를 해제한 DB 는 컨텍스트에서 제외됩니다. 변경은 이후 메시지에
                반영됩니다.
              </p>
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {context
              ? "이 페이지 내용을 기반으로 질문해 보세요."
              : "무엇이든 물어보세요."}
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex flex-col items-end gap-1">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-violet-600 px-3 py-2 text-sm text-white">
                {m.content}
              </div>
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                  {m.attachments.map((a, i) =>
                    a.kind === "image" && a.previewUrl ? (
                      <img
                        key={`${m.id}-att-${i}`}
                        src={a.previewUrl}
                        alt={a.label}
                        title={a.label}
                        className="h-16 w-16 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
                      />
                    ) : (
                      <span
                        key={`${m.id}-att-${i}`}
                        className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                      >
                        {a.kind === "page" ? (
                          <AtSign size={9} aria-hidden />
                        ) : (
                          <Paperclip size={9} aria-hidden />
                        )}
                        <span className="truncate">{a.label}</span>
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-1">
              {m.content ? (
                <>
                  {m.fromCache && (
                    <p className="px-1 text-[10px] text-zinc-400">캐시된 요약</p>
                  )}
                  <div className="prose prose-sm max-w-none rounded-lg bg-zinc-100 px-3 py-2 dark:prose-invert dark:bg-zinc-900">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  {!isStreaming && (
                    <div className="flex flex-wrap items-center gap-1">
                      {insertTargetPageId &&
                        (m.sourceAction === "actionItems" || looksLikeChecklist(m.content)) && (
                          <button
                            type="button"
                            onClick={() => setPreview({ mode: "checklist", content: m.content })}
                            className={`${bubbleActionClass} font-medium text-violet-600 dark:text-violet-400`}
                            title="체크리스트 블록으로 삽입 (미리보기 후 적용)"
                          >
                            <ListTodo size={12} aria-hidden />
                            체크리스트로 삽입
                          </button>
                        )}
                      {insertTargetPageId && (
                        <button
                          type="button"
                          onClick={() => setPreview({ mode: "insert", content: m.content })}
                          className={bubbleActionClass}
                          title="현재 커서 위치에 삽입 (미리보기 후 적용)"
                        >
                          <TextCursorInput size={12} aria-hidden />
                          문서에 삽입
                        </button>
                      )}
                      {insertTargetPageId && (
                        <button
                          type="button"
                          onClick={() => setPreview({ mode: "replacePage", content: m.content })}
                          className={bubbleActionClass}
                          title="페이지 본문 전체를 이 내용으로 교체 (미리보기 후 적용)"
                        >
                          <FileStack size={12} aria-hidden />
                          페이지 전체 교체
                        </button>
                      )}
                      {selectionRange && (
                        <button
                          type="button"
                          onClick={() => setPreview({ mode: "replaceSelection", content: m.content })}
                          className={bubbleActionClass}
                          title="원본 선택 영역을 이 내용으로 교체 (미리보기 후 적용)"
                        >
                          <Replace size={12} aria-hidden />
                          선택 교체
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(m.id, m.content)}
                        className={bubbleActionClass}
                        title="복사"
                      >
                        {copiedId === m.id ? (
                          <Check size={12} aria-hidden />
                        ) : (
                          <Copy size={12} aria-hidden />
                        )}
                        복사
                      </button>
                    </div>
                  )}
                </>
              ) : (
                !m.error &&
                isStreaming && (
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                    <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />
                    <span>{toolStatus ?? "응답 생성 중…"}</span>
                  </div>
                )
              )}
              {m.error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
                  {m.error}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <footer className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="mb-2">
          <label className="sr-only" htmlFor="ai-model-select">
            AI 모델
          </label>
          <select
            id="ai-model-select"
            value={effectiveModel}
            onChange={(e) => setModel(e.target.value)}
            disabled={isStreaming}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {/* 멘션·첨부 대기 칩 */}
        {(pendingMentions.length > 0 || pendingAttachments.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {pendingMentions.map((m) => (
              <span
                key={m.pageId}
                className="inline-flex max-w-[180px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
              >
                <AtSign size={10} className="shrink-0" aria-hidden />
                <span className="truncate">{m.title}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingMentions((prev) => prev.filter((x) => x.pageId !== m.pageId))
                  }
                  aria-label={`멘션 제거: ${m.title}`}
                  className="shrink-0 hover:text-violet-900 dark:hover:text-violet-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {pendingAttachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex max-w-[180px] items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {a.kind === "image" ? (
                  <img
                    src={a.previewUrl}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-cover"
                  />
                ) : (
                  <Paperclip size={10} className="shrink-0" aria-hidden />
                )}
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  aria-label={`첨부 제거: ${a.name}`}
                  className="shrink-0 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative flex items-end gap-2">
          {/* @멘션 페이지 검색 팝업 */}
          {mentionQuery !== null && mentionCandidates.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {mentionCandidates.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(p);
                  }}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    i === mentionIndex
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  ].join(" ")}
                >
                  <FileText size={13} className="shrink-0 text-zinc-400" aria-hidden />
                  <span className="truncate">{p.title || "제목 없음"}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
            aria-label="문서·이미지 첨부"
            title="문서·이미지 첨부 (이미지 최대 4장)"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,.txt,.md,.markdown,.csv,.json,.log,.xml,.yml,.yaml,.html,text/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              detectMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length > 0) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              // 멘션 팝업 내비게이션이 우선
              if (mentionQuery !== null && mentionCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex(
                    (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
                  );
                  return;
                }
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const picked = mentionCandidates[mentionIndex];
                  if (picked) applyMention(picked);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder="메시지 입력… (@페이지 멘션 · Enter 전송 · Shift+Enter 줄바꿈)"
            className="min-h-[3rem] flex-1 resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-md bg-zinc-200 p-2 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              aria-label="응답 중단"
              title="응답 중단"
            >
              <CircleStop size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={
                (!input.trim() &&
                  pendingMentions.length === 0 &&
                  pendingAttachments.length === 0) ||
                !workspaceId
              }
              className="rounded-md bg-violet-600 p-2 text-white hover:bg-violet-500 disabled:opacity-40"
              aria-label="전송"
              title="전송"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </footer>

      {/* 적용 전 미리보기 — 제안 내용을 확인하고 승인(적용)해야 페이지에 반영된다. */}
      {preview && (
        <div
          className="absolute inset-0 z-30 flex flex-col bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="AI 적용 미리보기"
          onClick={() => setPreview(null)}
        >
          <div
            className="m-auto flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                미리보기 — {APPLY_LABELS[preview.mode]}
              </h3>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="미리보기 닫기"
              >
                <X size={14} />
              </button>
            </div>
            {preview.mode === "replacePage" && (
              <p className="shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                페이지 본문 전체가 아래 내용으로 교체됩니다. 적용 후 Ctrl+Z 로 되돌릴 수 있습니다.
              </p>
            )}
            <div className="prose prose-sm max-w-none overflow-y-auto px-3 py-2 dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewMarkdown}</ReactMarkdown>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmApply}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
