// OAuth 파사드 암호 유틸 — 난수·해시·상수 시간 비교·PKCE.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** base64url 난수(기본 32바이트 → 43자). */
export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 길이가 달라도 예외 없이 false — 비교 자체는 상수 시간. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const RANDOM_ID_RE = /^[A-Za-z0-9_-]{43}$/;
export function isRandomIdFormat(value: string | null | undefined): value is string {
  return typeof value === "string" && RANDOM_ID_RE.test(value);
}

/** RFC 7636 code_verifier: 43~128자 unreserved 문자. */
export function isPkceVerifier(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

/** S256 code_challenge = base64url(SHA-256) — 항상 43자. */
export function isPkceChallenge(value: string | null | undefined): value is string {
  return typeof value === "string" && RANDOM_ID_RE.test(value);
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  return safeEqual(pkceS256(verifier), challenge);
}
