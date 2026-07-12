// SSE(`data: {json}`) 스트림 디코더 — fetch 청크 경계와 무관하게 라인 단위로 안전 파싱.

export type SseJsonDecoder = {
  /** 수신 텍스트 청크를 밀어 넣는다. 완성된 이벤트마다 onEvent 호출. */
  push(chunk: string): void;
  /** 스트림 종료 시 남은 버퍼 처리. */
  flush(): void;
};

export function createSseJsonDecoder(onEvent: (event: unknown) => void): SseJsonDecoder {
  let buffer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      onEvent(JSON.parse(payload));
    } catch {
      // 청크 경계에서 잘린 라인은 무시 — 다음 push 에서 이어져 완성된다.
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        consumeLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    },
    flush() {
      if (buffer) consumeLine(buffer);
      buffer = "";
    },
  };
}
