// AI 채팅 사이드 패널 — 페이지 컨텍스트 기반 대화(Phase 1).
import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleStop,
  Copy,
  Eraser,
  FileText,
  ListTodo,
  Loader2,
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
} from "../../lib/ai/models";
import {
  insertMarkdownAtCursor,
  replaceRangeWithMarkdown,
} from "../../lib/ai/insertToEditor";
import {
  checklistMarkdownForInsert,
  looksLikeChecklist,
} from "../../lib/ai/extractChecklist";

export function AiChatPanel() {
  const panelOpen = useAiStore((s) => s.panelOpen);
  const context = useAiStore((s) => s.context);
  const messages = useAiStore((s) => s.messages);
  const isStreaming = useAiStore((s) => s.isStreaming);
  const preparing = useAiStore((s) => s.preparing);
  const toolStatus = useAiStore((s) => s.toolStatus);
  const model = useAiStore((s) => s.model);
  const configByWorkspace = useAiStore((s) => s.configByWorkspace);
  const closePanel = useAiStore((s) => s.closePanel);
  const clearChat = useAiStore((s) => s.clearChat);
  const setModel = useAiStore((s) => s.setModel);
  const send = useAiStore((s) => s.send);
  const stop = useAiStore((s) => s.stop);
  const deepAnalysis = useAiStore((s) => s.deepAnalysis);
  const confirmDeepAnalysis = useAiStore((s) => s.confirmDeepAnalysis);
  const declineDeepAnalysis = useAiStore((s) => s.declineDeepAnalysis);
  const selectionRange = useAiStore((s) => s.selectionRange);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const activePageId = usePageStore((s) => s.activePageId);
  const showToast = useUiStore((s) => s.showToast);

  const updateContextOptions = useAiStore((s) => s.updateContextOptions);
  const [chipOpen, setChipOpen] = useState(false);
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    if (panelOpen) inputRef.current?.focus();
  }, [panelOpen]);

  if (!panelOpen) return null;

  const handleSend = () => {
    if (!workspaceId || !input.trim() || isStreaming || preparing) return;
    void send(workspaceId, input);
    setInput("");
  };

  // 응답을 문서로 — 삽입 대상은 선택 원본 페이지 > 컨텍스트 페이지 > 활성 페이지 순
  const insertTargetPageId = selectionRange?.pageId ?? context?.pageId ?? activePageId;
  const handleInsert = (content: string) => {
    if (!insertTargetPageId) {
      showToast("삽입할 페이지가 없습니다");
      return;
    }
    const ok = insertMarkdownAtCursor(insertTargetPageId, content);
    showToast(ok ? "문서에 삽입했습니다" : "삽입할 위치를 찾지 못했습니다");
  };
  const handleInsertChecklist = (content: string) => {
    if (!insertTargetPageId) {
      showToast("삽입할 페이지가 없습니다");
      return;
    }
    const md = checklistMarkdownForInsert(content);
    const ok = insertMarkdownAtCursor(insertTargetPageId, md);
    showToast(ok ? "체크리스트로 삽입했습니다" : "삽입할 위치를 찾지 못했습니다");
  };
  const handleReplace = (content: string) => {
    if (!selectionRange) return;
    const ok = replaceRangeWithMarkdown(selectionRange.pageId, selectionRange, content);
    showToast(ok ? "선택 영역을 교체했습니다" : "문서가 변경되어 교체할 수 없습니다");
    // 같은 범위 중복 교체(범위 어긋남) 방지 — 성공 시 원본 범위를 비운다
    if (ok) useAiStore.setState({ selectionRange: null });
  };
  const handleCopy = (id: string, content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    });
  };

  const bubbleActionClass =
    "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  return (
    <aside
      className="fixed inset-y-0 right-0 z-[400] flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl sm:w-[400px] dark:border-zinc-700 dark:bg-zinc-950"
      aria-label="AI 채팅 패널"
    >
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
          {chipOpen && context.databaseId && (
            <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
              <label className="flex items-center justify-between gap-2">
                <span>포함 행 수</span>
                <select
                  value={String(context.options?.maxRows ?? 200)}
                  disabled={isStreaming}
                  onChange={(e) =>
                    updateContextOptions({ maxRows: Number(e.target.value) })
                  }
                  className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {[30, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}행
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>행 본문 포함</span>
                <input
                  type="checkbox"
                  checked={Boolean(context.options?.includeRowBodies)}
                  disabled={isStreaming}
                  onChange={(e) =>
                    updateContextOptions({ includeRowBodies: e.target.checked })
                  }
                />
              </label>
              <p className="text-[10px] text-zinc-400">
                본문은 예산 내에서 포함되며, 넘치는 행은 AI 가 필요할 때 도구로
                조회합니다. 변경은 이후 메시지에 반영됩니다.
              </p>
            </div>
          )}
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
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-violet-600 px-3 py-2 text-sm text-white">
                {m.content}
              </div>
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
                            onClick={() => handleInsertChecklist(m.content)}
                            className={`${bubbleActionClass} font-medium text-violet-600 dark:text-violet-400`}
                            title="체크리스트 블록으로 삽입"
                          >
                            <ListTodo size={12} aria-hidden />
                            체크리스트로 삽입
                          </button>
                        )}
                      {insertTargetPageId && (
                        <button
                          type="button"
                          onClick={() => handleInsert(m.content)}
                          className={bubbleActionClass}
                          title="현재 커서 위치에 삽입"
                        >
                          <TextCursorInput size={12} aria-hidden />
                          문서에 삽입
                        </button>
                      )}
                      {selectionRange && (
                        <button
                          type="button"
                          onClick={() => handleReplace(m.content)}
                          className={bubbleActionClass}
                          title="원본 선택 영역을 이 내용으로 교체"
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
        {/* 준비 단계(행 본문 로딩·분량 확인) 진행 표시 */}
        {preparing && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
            <span>{toolStatus ?? "준비 중…"}</span>
          </div>
        )}
        {/* 전수 분석 확인 — 본문이 단일 요청 예산을 넘을 때 요청 수 고지 */}
        {deepAnalysis && !isStreaming && (
          <div className="mb-2 space-y-2 rounded-md border border-violet-200 bg-violet-50 p-2.5 text-xs dark:border-violet-800 dark:bg-violet-950/30">
            <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
              “{deepAnalysis.question}”
            </p>
            <p className="text-zinc-700 dark:text-zinc-200">
              본문 분량이 많아 한 번에 담을 수 없습니다.{" "}
              <strong>{deepAnalysis.plan.analyzedRows}행</strong>의 본문 전체를{" "}
              배치 {deepAnalysis.plan.batches.length}개로 나눠 분석할 수 있습니다
              (AI 요청 약 {deepAnalysis.plan.batches.length + 1}건, 시간이 다소
              걸립니다).
              {deepAnalysis.plan.skippedRows > 0 &&
                ` ${deepAnalysis.plan.skippedRows}행은 상한 초과로 제외됩니다.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void confirmDeepAnalysis(workspaceId)}
                className="rounded-md bg-violet-600 px-2.5 py-1.5 text-white hover:bg-violet-500"
              >
                전체 본문 분석
              </button>
              <button
                type="button"
                onClick={() => void declineDeepAnalysis(workspaceId)}
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                포함된 범위로만 답변
              </button>
            </div>
          </div>
        )}
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
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder="메시지 입력… (Enter 전송 · Shift+Enter 줄바꿈)"
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
              disabled={!input.trim() || !workspaceId || preparing}
              className="rounded-md bg-violet-600 p-2 text-white hover:bg-violet-500 disabled:opacity-40"
              aria-label="전송"
              title="전송"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
