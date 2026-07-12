// AI 채팅 패널 상태 + 워크스페이스 AI 설정 캐시.
// 대화 내용은 세션 전용(미persist), 모델 선택만 persist 한다.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import {
  getWorkspaceAiConfigApi,
  type WorkspaceAiConfig,
} from "../lib/sync/aiConfigApi";
import { streamAiChat, AiRequestError } from "../lib/ai/aiClient";
import type { AiContext } from "../lib/ai/contextBuilder";

export type AiChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 스트리밍 실패 시 말풍선에 표시할 에러 (assistant 전용) */
  error?: string | null;
};

/** 대화 이력 전송 상한 — 토큰/비용 통제 (GamePlanner CHAT_HISTORY_LIMIT 패턴) */
const CHAT_HISTORY_LIMIT = 8;

let abortController: AbortController | null = null;
let bubbleSeq = 0;
function nextBubbleId(): string {
  bubbleSeq += 1;
  return `ai-${Date.now()}-${bubbleSeq}`;
}

type AiState = {
  panelOpen: boolean;
  context: AiContext | null;
  messages: AiChatBubble[];
  isStreaming: boolean;
  /** null 이면 워크스페이스 기본 모델 사용 */
  model: string | null;
  configByWorkspace: Record<string, WorkspaceAiConfig>;
};

type AiActions = {
  openPanel: (context: AiContext | null) => void;
  closePanel: () => void;
  clearChat: () => void;
  setModel: (model: string | null) => void;
  /** 워크스페이스 AI 설정을 1회 로드해 캐시 (UI 게이팅용). 실패는 조용히 무시. */
  ensureConfig: (workspaceId: string) => Promise<void>;
  applyConfig: (config: WorkspaceAiConfig) => void;
  send: (workspaceId: string, text: string) => Promise<void>;
  stop: () => void;
};

export const useAiStore = create<AiState & AiActions>()(
  persist(
    (set, get) => ({
      panelOpen: false,
      context: null,
      messages: [],
      isStreaming: false,
      model: null,
      configByWorkspace: {},

      openPanel: (context) =>
        set((s) => ({
          panelOpen: true,
          context,
          // 다른 페이지 컨텍스트로 다시 열면 이전 대화를 비운다
          messages:
            context && s.context && context.pageId !== s.context.pageId ? [] : s.messages,
        })),
      closePanel: () => set({ panelOpen: false }),
      clearChat: () => set({ messages: [] }),
      setModel: (model) => set({ model }),

      ensureConfig: async (workspaceId) => {
        if (!workspaceId || get().configByWorkspace[workspaceId]) return;
        try {
          const config = await getWorkspaceAiConfigApi(workspaceId);
          set((s) => ({ configByWorkspace: { ...s.configByWorkspace, [workspaceId]: config } }));
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
        if (!trimmed || get().isStreaming) return;

        const userBubble: AiChatBubble = { id: nextBubbleId(), role: "user", content: trimmed };
        const assistantId = nextBubbleId();
        const history = [...get().messages, userBubble];
        set({
          messages: [...history, { id: assistantId, role: "assistant", content: "" }],
          isStreaming: true,
        });

        const patchAssistant = (patch: Partial<AiChatBubble>) =>
          set((s) => ({
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
          }));

        abortController = new AbortController();
        try {
          const context = get().context;
          await streamAiChat({
            workspaceId,
            pageId: context?.pageId ?? null,
            model: get().model,
            // 에러 말풍선·빈 응답 제외, 최근 N개만 전송
            messages: history
              .filter((m) => !m.error && m.content)
              .slice(-CHAT_HISTORY_LIMIT)
              .map((m) => ({ role: m.role, content: m.content })),
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
      },

      stop: () => {
        abortController?.abort();
      },
    }),
    {
      name: "quicknote.ai.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ model: state.model }),
    },
  ),
);
