// AI 채팅 패널 상태 + 워크스페이스 AI 설정 캐시.
// 대화 내용은 세션 전용(미persist), 모델 선택만 persist 한다.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import {
  getWorkspaceAiConfigApi,
  type WorkspaceAiConfig,
} from "../lib/sync/aiConfigApi";
import {
  streamAiChat,
  AiRequestError,
  isRetryableRateLimit,
  sleepWithAbort,
  type AiAction,
  type AiActionOptions,
  type AiChatMessage,
} from "../lib/ai/aiClient";
import {
  availableModels,
  defaultModelForProvider,
} from "../lib/ai/models";
import {
  buildSummaryCacheKey,
  getSummaryCache,
  hashAiContextMarkdown,
  setSummaryCache,
} from "../lib/ai/summaryCache";
import {
  rebuildAiContext,
  type AiContext,
  type AiContextOptions,
} from "../lib/ai/contextBuilder";
import { loadPageBodies } from "../lib/ai/loadRowBodies";
import {
  AI_TOOL_ROUND_LIMIT,
  executeAiTool,
  toolStatusLabel,
  type AiWireMessage,
} from "../lib/ai/tools";

export type AiChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 스트리밍 실패 시 말풍선에 표시할 에러 (assistant 전용) */
  error?: string | null;
  /** 선택 영역 액션 출처 — 체크리스트 삽입 UX 등에 사용 */
  sourceAction?: AiAction | null;
  /** 요약 캐시 히트 표시 */
  fromCache?: boolean;
};

/** 선택 영역 교체용 원본 범위 — 문서가 바뀌면 무효일 수 있어 교체 시 재검증한다. */
export type AiSelectionRange = { pageId: string; from: number; to: number };

/** 대화 이력 전송 상한 — 토큰/비용 통제 (GamePlanner CHAT_HISTORY_LIMIT 패턴) */
const CHAT_HISTORY_LIMIT = 8;

/** 출력 토큰 상한으로 잘린 응답의 자동 이어쓰기 상한. */
const MAX_CONTINUATIONS = 3;
const CONTINUE_PROMPT =
  "출력이 중간에 끊겼다. 끊긴 지점부터 이어서 계속 작성하라. 이미 출력한 내용은 반복하지 마라.";

/** 제공사별 출력 길이 초과 finishReason — Gemini: MAX_TOKENS, Anthropic: max_tokens. */
function isLengthCutFinish(finishReason: string | null): boolean {
  return (
    finishReason === "MAX_TOKENS" || finishReason === "max_tokens" || finishReason === "length"
  );
}

let abortController: AbortController | null = null;
let bubbleSeq = 0;
function nextBubbleId(): string {
  bubbleSeq += 1;
  return `ai-${Date.now()}-${bubbleSeq}`;
}

/** 대화 리셋 기준 키 — 같은 페이지/DB 컨텍스트면 대화를 이어간다. */
function contextKey(context: AiContext | null): string {
  if (!context) return "none";
  return context.pageId ?? context.databaseId ?? "none";
}

type AiState = {
  panelOpen: boolean;
  context: AiContext | null;
  selectionRange: AiSelectionRange | null;
  messages: AiChatBubble[];
  isStreaming: boolean;
  /** tool 실행 중 UX 칩 문구 */
  toolStatus: string | null;
  /** null 이면 워크스페이스 기본 모델 사용 */
  model: string | null;
  configByWorkspace: Record<string, WorkspaceAiConfig>;
};

type AiActions = {
  openPanel: (
    context: AiContext | null,
    opts?: { selectionRange?: AiSelectionRange | null },
  ) => void;
  closePanel: () => void;
  clearChat: () => void;
  setModel: (model: string | null) => void;
  /** 워크스페이스 AI 설정을 1회 로드해 캐시 (UI 게이팅용). 실패는 조용히 무시. */
  ensureConfig: (workspaceId: string) => Promise<void>;
  applyConfig: (config: WorkspaceAiConfig) => void;
  /** 컨텍스트 옵션(행 수·본문 포함) 갱신 — 대화는 유지. */
  updateContextOptions: (patch: AiContextOptions) => void;
  send: (workspaceId: string, text: string) => Promise<void>;
  /** 선택 영역 액션(요약·번역 등) — 현재 컨텍스트를 대상으로 서버 템플릿 실행. */
  runAction: (
    workspaceId: string,
    args: { action: AiAction; title: string; options?: AiActionOptions },
  ) => Promise<void>;
  stop: () => void;
};

export const useAiStore = create<AiState & AiActions>()(
  persist(
    (set, get) => {
      /** 공통 스트리밍 실행 — user 말풍선/assistant 스트림/에러 처리. */
      const resolveModel = (workspaceId: string): string => {
        const wsConfig = get().configByWorkspace[workspaceId];
        const keyed =
          wsConfig?.providers?.filter((p) => p.hasKey).map((p) => p.provider) ??
          (wsConfig?.hasKey && wsConfig.provider ? [wsConfig.provider] : []);
        const allowed = availableModels(keyed);
        const selected = get().model;
        return selected && allowed.some((m) => m.id === selected)
          ? selected
          : wsConfig?.defaultModel && allowed.some((m) => m.id === wsConfig.defaultModel)
            ? wsConfig.defaultModel
            : (allowed[0]?.id ?? defaultModelForProvider(wsConfig?.provider));
      };

      const runStream = async (
        workspaceId: string,
        args: {
          action: AiAction;
          options?: AiActionOptions;
          userBubbleText: string;
          payloadMessages: AiChatMessage[];
          /** 지정 시 store 컨텍스트 대신 사용 — 전수 분석 추출 결과 후속 질문 등. */
          contextOverride?: AiContext;
        },
      ): Promise<void> => {
        if (get().isStreaming) return;

        let pendingSummaryKey: string | null = null;
        const model = resolveModel(workspaceId);

        // 요약 캐시 — 동일 문서·모델이면 네트워크 스킵
        if (args.action === "summarize") {
          const context = get().context;
          if (context?.markdown) {
            const cacheKey = buildSummaryCacheKey({
              workspaceId,
              pageId: context.pageId,
              databaseId: context.databaseId,
              contentHash: hashAiContextMarkdown(context.markdown),
              model,
            });
            const hit = getSummaryCache(cacheKey);
            if (hit) {
              set((s) => ({
                messages: [
                  ...s.messages,
                  { id: nextBubbleId(), role: "user", content: args.userBubbleText },
                  {
                    id: nextBubbleId(),
                    role: "assistant",
                    content: hit.markdown,
                    sourceAction: "summarize",
                    fromCache: true,
                  },
                ],
              }));
              return;
            }
            pendingSummaryKey = cacheKey;
          }
        }

        const userBubble: AiChatBubble = {
          id: nextBubbleId(),
          role: "user",
          content: args.userBubbleText,
        };
        const assistantId = nextBubbleId();
        set((s) => ({
          messages: [
            ...s.messages,
            userBubble,
            {
              id: assistantId,
              role: "assistant",
              content: "",
              sourceAction: args.action === "chat" ? null : args.action,
            },
          ],
          isStreaming: true,
        }));

        const patchAssistant = (patch: Partial<AiChatBubble>) =>
          set((s) => ({
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
          }));

        abortController = new AbortController();
        const signal = abortController.signal;
        try {
          // 본문 포함 대상인데 아직 안 불러온 행이 있으면 전송 전에 로드 후 재조립
          // (contextOverride 는 이미 완성된 컨텍스트이므로 프리페치 대상 아님)
          let context = args.contextOverride ?? get().context;
          if (!args.contextOverride && context?.pendingBodyPageIds?.length) {
            set({
              toolStatus: `행 본문 ${context.pendingBodyPageIds.length}건 불러오는 중…`,
            });
            await loadPageBodies(context.pendingBodyPageIds);
            const rebuilt = rebuildAiContext(context, {});
            if (rebuilt) {
              set({ context: rebuilt });
              context = rebuilt;
            }
            set({ toolStatus: null });
          }
          const enableTools = args.action === "chat";
          const baseMessages: AiWireMessage[] = args.payloadMessages.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          const streamRounds = async (): Promise<void> => {
            let wireMessages = baseMessages;
            let toolRounds = 0;
            let continuations = 0;
            // 이번 턴에서 조립한 assistant 전체 텍스트 — 길이 초과 이어쓰기의 프리픽스
            let assistantText = "";
            for (;;) {
              set({ toolStatus: null });
              let segment = "";
              const result = await streamAiChat({
                workspaceId,
                pageId: context?.pageId ?? null,
                action: args.action,
                options: args.options,
                model,
                messages: wireMessages,
                context: context
                  ? { label: context.label, markdown: context.markdown }
                  : null,
                enableTools,
                signal,
                onDelta: (delta) => {
                  segment += delta;
                  set((s) => ({
                    messages: s.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: m.content + delta } : m,
                    ),
                  }));
                },
                onToolCall: (call) => set({ toolStatus: toolStatusLabel(call.name) }),
              });
              assistantText += segment;

              if (enableTools && result.toolCalls.length > 0) {
                toolRounds += 1;
                if (toolRounds >= AI_TOOL_ROUND_LIMIT) break;
                // 도구 호출 턴 — 로컬 해석 후 후속 요청
                wireMessages = [
                  ...wireMessages,
                  { role: "assistant_tools", toolCalls: result.toolCalls },
                ];
                for (const call of result.toolCalls) {
                  set({ toolStatus: toolStatusLabel(call.name) });
                  const content = await executeAiTool(call);
                  wireMessages.push({
                    role: "tool",
                    toolCallId: call.id,
                    name: call.name,
                    content,
                  });
                }
                // 다음 라운드 텍스트는 이어서 붙인다(도구만 호출한 턴의 빈 텍스트 유지)
                continue;
              }

              // 출력 토큰 상한으로 잘린 응답은 끊긴 지점부터 자동 이어쓰기
              if (isLengthCutFinish(result.finishReason) && continuations < MAX_CONTINUATIONS) {
                continuations += 1;
                wireMessages = [
                  ...wireMessages,
                  { role: "assistant", content: assistantText },
                  { role: "user", content: CONTINUE_PROMPT },
                ];
                set({ toolStatus: "응답이 길어 이어서 생성 중…" });
                continue;
              }
              break;
            }
          };

          // 사용량 제한(429)은 Retry-After 만큼 대기 후 1회 자동 재시도 (GamePlanner 백오프 이식)
          try {
            await streamRounds();
          } catch (e) {
            if (!isRetryableRateLimit(e) || signal.aborted) throw e;
            const waitSec = Math.min(Math.max(e.retryAfterSec ?? 2, 1), 30);
            patchAssistant({ content: "" }); // 부분 출력 리셋 후 재시도
            set({ toolStatus: `사용량 제한 — ${waitSec}초 후 재시도` });
            await sleepWithAbort(waitSec * 1000, signal);
            await streamRounds();
          }
          set({ toolStatus: null });

          if (pendingSummaryKey) {
            const content = get().messages.find((m) => m.id === assistantId)?.content ?? "";
            if (content) {
              setSummaryCache(pendingSummaryKey, {
                markdown: content,
                model,
                createdAt: Date.now(),
              });
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            patchAssistant({ error: null });
          } else if (e instanceof AiRequestError) {
            patchAssistant({ error: e.message });
          } else {
            console.error("AI 채팅 실패", e);
            patchAssistant({ error: "AI 요청 중 오류가 발생했습니다" });
          }
        } finally {
          abortController = null;
          set({ isStreaming: false, toolStatus: null });
        }
      };

      /** 일반 단일 요청 전송 — 최근 N개 히스토리 포함. */
      const sendNormal = async (
        workspaceId: string,
        trimmed: string,
        contextOverride?: AiContext,
      ): Promise<void> => {
        // 에러 말풍선·빈 응답 제외, 최근 N개만 전송
        const history = [...get().messages, { role: "user" as const, content: trimmed, error: null }]
          .filter((m) => !m.error && m.content)
          .slice(-CHAT_HISTORY_LIMIT)
          .map((m) => ({ role: m.role, content: m.content }));
        await runStream(workspaceId, {
          action: "chat",
          userBubbleText: trimmed,
          payloadMessages: history,
          contextOverride,
        });
      };

      return {
        panelOpen: false,
        context: null,
        selectionRange: null,
        messages: [],
        isStreaming: false,
        toolStatus: null,
        model: null,
        configByWorkspace: {},

        openPanel: (context, opts) =>
          set((s) => ({
            panelOpen: true,
            context,
            selectionRange: opts?.selectionRange ?? null,
            // 선택 영역으로 열거나 다른 페이지/DB 컨텍스트로 열면 이전 대화를 비운다
            messages:
              opts?.selectionRange || contextKey(context) !== contextKey(s.context)
                ? []
                : s.messages,
          })),
        closePanel: () => {
          // 패널을 닫으면 진행 중 스트림도 중단 — 백그라운드 토큰 소모 방지
          abortController?.abort();
          set({ panelOpen: false });
        },
        clearChat: () => set({ messages: [] }),
        setModel: (model) => set({ model }),

        ensureConfig: async (workspaceId) => {
          if (!workspaceId || get().configByWorkspace[workspaceId]) return;
          try {
            const config = await getWorkspaceAiConfigApi(workspaceId);
            set((s) => ({
              configByWorkspace: { ...s.configByWorkspace, [workspaceId]: config },
            }));
          } catch {
            // 미배포 스키마·권한 없음 등 — AI UI 비노출 상태 유지
          }
        },
        applyConfig: (config) =>
          set((s) => ({
            configByWorkspace: { ...s.configByWorkspace, [config.workspaceId]: config },
          })),

        updateContextOptions: (patch) => {
          const current = get().context;
          if (!current) return;
          const next = rebuildAiContext(current, patch);
          if (!next) return;
          set({ context: next });
          // 본문 포함 대상 중 미로드 행이 있으면 백그라운드로 불러와 재조립
          // (전송 시점에도 한 번 더 보정하므로 실패해도 안전)
          const pending = next.pendingBodyPageIds;
          if (pending?.length) {
            void loadPageBodies(pending).then(() => {
              if (get().context !== next) return; // 그 사이 컨텍스트가 바뀌면 무시
              const rebuilt = rebuildAiContext(next, {});
              if (rebuilt) set({ context: rebuilt });
            });
          }
        },

        send: async (workspaceId, text) => {
          const trimmed = text.trim();
          if (!trimmed || get().isStreaming) return;
          await sendNormal(workspaceId, trimmed);
        },

        runAction: async (workspaceId, args) => {
          await runStream(workspaceId, {
            action: args.action,
            options: args.options,
            userBubbleText: args.title,
            payloadMessages: [{ role: "user", content: args.title }],
          });
        },

        stop: () => {
          abortController?.abort();
        },
      };
    },
    {
      name: "quicknote.ai.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ model: state.model }),
    },
  ),
);
