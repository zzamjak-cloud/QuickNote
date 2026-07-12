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
  type AiAction,
  type AiActionOptions,
  type AiChatMessage,
} from "../lib/ai/aiClient";
import {
  availableModels,
  defaultModelForProvider,
} from "../lib/ai/models";
import type { AiContext } from "../lib/ai/contextBuilder";

export type AiChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 스트리밍 실패 시 말풍선에 표시할 에러 (assistant 전용) */
  error?: string | null;
};

/** 선택 영역 교체용 원본 범위 — 문서가 바뀌면 무효일 수 있어 교체 시 재검증한다. */
export type AiSelectionRange = { pageId: string; from: number; to: number };

/** 대화 이력 전송 상한 — 토큰/비용 통제 (GamePlanner CHAT_HISTORY_LIMIT 패턴) */
const CHAT_HISTORY_LIMIT = 8;

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
      const runStream = async (
        workspaceId: string,
        args: {
          action: AiAction;
          options?: AiActionOptions;
          userBubbleText: string;
          payloadMessages: AiChatMessage[];
        },
      ): Promise<void> => {
        if (get().isStreaming) return;
        const userBubble: AiChatBubble = {
          id: nextBubbleId(),
          role: "user",
          content: args.userBubbleText,
        };
        const assistantId = nextBubbleId();
        set((s) => ({
          messages: [...s.messages, userBubble, { id: assistantId, role: "assistant", content: "" }],
          isStreaming: true,
        }));

        const patchAssistant = (patch: Partial<AiChatBubble>) =>
          set((s) => ({
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
          }));

        abortController = new AbortController();
        try {
          const context = get().context;
          const wsConfig = get().configByWorkspace[workspaceId];
          const keyed =
            wsConfig?.providers?.filter((p) => p.hasKey).map((p) => p.provider) ??
            (wsConfig?.hasKey && wsConfig.provider ? [wsConfig.provider] : []);
          const allowed = availableModels(keyed);
          const selected = get().model;
          // 키 없는 제공사 모델이 persist 되어 있으면 기본 모델로 폴백
          const model =
            selected && allowed.some((m) => m.id === selected)
              ? selected
              : wsConfig?.defaultModel && allowed.some((m) => m.id === wsConfig.defaultModel)
                ? wsConfig.defaultModel
                : (allowed[0]?.id ?? defaultModelForProvider(wsConfig?.provider));
          await streamAiChat({
            workspaceId,
            pageId: context?.pageId ?? null,
            action: args.action,
            options: args.options,
            model,
            messages: args.payloadMessages,
            context: context ? { label: context.label, markdown: context.markdown } : null,
            signal: abortController.signal,
            onDelta: (delta) =>
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + delta } : m,
                ),
              })),
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            patchAssistant({ error: null }); // 사용자 중단 — 지금까지 내용 유지
          } else if (e instanceof AiRequestError) {
            patchAssistant({ error: e.message });
          } else {
            console.error("AI 채팅 실패", e);
            patchAssistant({ error: "AI 요청 중 오류가 발생했습니다" });
          }
        } finally {
          abortController = null;
          set({ isStreaming: false });
        }
      };

      return {
        panelOpen: false,
        context: null,
        selectionRange: null,
        messages: [],
        isStreaming: false,
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
        closePanel: () => set({ panelOpen: false }),
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

        send: async (workspaceId, text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          // 에러 말풍선·빈 응답 제외, 최근 N개만 전송
          const history = [...get().messages, { role: "user" as const, content: trimmed, error: null }]
            .filter((m) => !m.error && m.content)
            .slice(-CHAT_HISTORY_LIMIT)
            .map((m) => ({ role: m.role, content: m.content }));
          await runStream(workspaceId, {
            action: "chat",
            userBubbleText: trimmed,
            payloadMessages: history,
          });
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
