// 원본 보호 비밀(x-qn-origin-verify) — CloudFront 가 원본 요청에 붙이는 값을 Secrets Manager 에서 읽어 캐시한다.
// 저장소가 공개라 값은 env·템플릿에 평문으로 두지 않는다(mcp-edge-construct.ts). 교체 시 캐시 TTL(5분) 안에 반영된다.
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export const ORIGIN_VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;

export type OriginVerifyState =
  /** 비밀 미설정(로컬·테스트) — 검사하지 않는다. */
  | { kind: "disabled" }
  | { kind: "ready"; value: string }
  /** 설정됐는데 못 읽음 — 호출측이 503 으로 거절(fail-closed). */
  | { kind: "unavailable" };

export type SecretReader = (secretId: string) => Promise<string | undefined>;

let cache: { at: number; value: string } | null = null;

async function readSecret(secretId: string): Promise<string | undefined> {
  const r = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  return r.SecretString;
}

export async function resolveOriginVerify(read: SecretReader = readSecret, nowMs = Date.now()): Promise<OriginVerifyState> {
  const secretId = process.env.ORIGIN_VERIFY_SECRET_ID;
  if (!secretId) return { kind: "disabled" };
  if (cache && nowMs - cache.at < ORIGIN_VERIFY_CACHE_TTL_MS) return { kind: "ready", value: cache.value };
  try {
    const value = await read(secretId);
    if (!value) return { kind: "unavailable" };
    cache = { at: nowMs, value };
    return { kind: "ready", value };
  } catch (err) {
    // 만료된 값으로 계속 허용하지 않는다 — 교체 중 옛 값이 영구히 통하는 것을 막는다.
    console.error("mcp origin-verify 비밀 조회 실패", (err as Error)?.name);
    return { kind: "unavailable" };
  }
}

/** 테스트 전용: 캐시 초기화. */
export function resetOriginVerifyCache(): void {
  cache = null;
}
