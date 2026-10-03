// QFM 변환 오류 — MCP 계층이 code 로 분기해 사용자/AI 에게 안내한다.
export type QfmErrorCode = "INPUT_TOO_LARGE" | "UNRESOLVED_BLOCK_REF" | "DUPLICATE_BLOCK_REF";

export class QfmError extends Error {
  readonly code: QfmErrorCode;
  readonly blockId?: string;

  constructor(code: QfmErrorCode, message: string, blockId?: string) {
    super(message);
    this.name = "QfmError";
    this.code = code;
    this.blockId = blockId;
  }
}
