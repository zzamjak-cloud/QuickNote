// Lambda 스트리밍 응답 전역(awslambda) 타입 — 런타임이 주입하므로 선언만 제공.
export type ResponseStream = {
  write(chunk: string | Uint8Array): void;
  end(): void;
  setContentType?(type: string): void;
  /** 런타임 실체는 Node Writable — 클라이언트 끊김 감지용 */
  destroyed?: boolean;
  on?(event: "close" | "error", cb: () => void): void;
};

declare global {
   
  var awslambda: {
    streamifyResponse<E>(
      handler: (event: E, responseStream: ResponseStream) => Promise<void>,
    ): unknown;
    HttpResponseStream: {
      from(
        stream: ResponseStream,
        metadata: { statusCode: number; headers?: Record<string, string> },
      ): ResponseStream;
    };
  };
}
