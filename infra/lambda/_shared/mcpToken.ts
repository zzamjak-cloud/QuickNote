// MCP Personal Access Token(PAT) 공용 유틸 — v5-resolvers(발급)와 mcp-server(검증)가 같이 쓴다.
// 원문 토큰은 발급 응답에 한 번만 싣고, 테이블에는 SHA-256 해시만 저장한다.
import { createHash, randomBytes } from "node:crypto";

export const MCP_TOKEN_PREFIX = "qn_pat_";
export const MCP_TOKEN_SCOPES = ["read", "write"] as const;
export type McpTokenScope = (typeof MCP_TOKEN_SCOPES)[number];

/** mcp-tokens 테이블 항목. tokenHash 가 PK, byMember GSI(memberId, createdAt). */
export type McpTokenRecord = {
  tokenHash: string;
  tokenId: string;
  memberId: string;
  name: string;
  scopes: McpTokenScope[];
  /** 빈 배열 = 멤버가 접근 가능한 전체 워크스페이스. */
  workspaceIds: string[];
  /** 목록 UI 식별용 원문 마지막 4글자. */
  tokenHint: string;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// 32바이트(256bit) 를 base62 로 표현할 때의 고정 길이 — 길이를 고정해 형식 검증을 단순화한다.
const TOKEN_BODY_LENGTH = 43;

function toBase62(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(TOKEN_BODY_LENGTH, "0");
}

/** 새 토큰 원문 생성: qn_pat_ + 32 랜덤 바이트 base62. */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${toBase62(randomBytes(32))}`;
}

/** 토큰 원문의 형식 검사(조회 전 쓰레기 입력 차단). */
export function isMcpTokenFormat(value: string): boolean {
  return new RegExp(`^${MCP_TOKEN_PREFIX}[0-9A-Za-z]{${TOKEN_BODY_LENGTH}}$`).test(value);
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 폐기·만료되지 않은 토큰인지. expiresAt 은 ISO 문자열 비교. */
export function isMcpTokenActive(record: Pick<McpTokenRecord, "revokedAt" | "expiresAt">, nowIso: string): boolean {
  if (record.revokedAt) return false;
  if (record.expiresAt && record.expiresAt <= nowIso) return false;
  return true;
}
