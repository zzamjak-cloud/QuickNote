// AI 채팅 사이드 패널 — 페이지 컨텍스트 기반 대화(Phase 1).
import { useEffect, useRef, useState } from "react";
import { CircleStop, Eraser, FileText, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAiStore } from "../../store/aiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { AI_DEFAULT_MODEL, AI_MODELS } from "../../lib/ai/models";

export function AiChatPanel() {
  const panelOpen = useAiStore((s) => s.panelOpen);
  const context = useAiStore((s) => s.context);
  const messages = useAiStore((s) => s.messages);
  const isStreaming = useAiStore((s) => s.isStreaming);
  const model = useAiStore((s) => s.model);
  const configByWorkspace = useAiStore((s) => s.configByWorkspace);
  const closePanel = useAiStore((s) => s.closePanel);
  const clearChat = useAiStore((s) => s.clearChat);
  const setModel = useAiStore((s) => s.setModel);
  const send = useAiStore((s) => s.send);
  const stop = useAiStore((s) => s.stop);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const workspaceId = currentWorkspaceId ?? "";
  const defaultModel = workspaceId
    ? configByWorkspace[workspaceId]?.defaultModel ?? AI_DEFAULT_MODEL
    : AI_DEFAULT_MODEL;
  const effectiveModel = model ?? defaultModel;

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
    if (!workspaceId || !input.trim() || isStreaming) return;
    void send(workspaceId, input);
    setInput("");
  };

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

      {/* 컨텍스트 칩 — 무엇이 AI 에 전달되는지 항상 가시화 */}
      {context && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <FileText size={12} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{context.label}</span>
          {context.truncated && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              내용이 많아 일부만 전달됨
            </span>
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
                <div className="prose prose-sm max-w-none rounded-lg bg-zinc-100 px-3 py-2 dark:prose-invert dark:bg-zinc-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                !m.error &&
                isStreaming && (
                  <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                    응답 생성 중…
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
            {AI_MODELS.map((m) => (
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
              disabled={!input.trim() || !workspaceId}
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
