// Cognito Hosted UI(Google IdP) 연동 — 파사드 전용 public 앱 클라이언트 + PKCE 로 서버 측 코드 교환.
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { OAuthConfig } from "./config";

export type CognitoOps = {
  clientId(): Promise<string>;
  /** 인가 코드 → ID 토큰(원문). */
  exchangeCode(args: { code: string; redirectUri: string; verifier: string; clientId: string }): Promise<string>;
  verifyIdToken(idToken: string, clientId: string): Promise<{ sub: string; nonce?: string }>;
};

const COGNITO_TIMEOUT_MS = 5000;

export function cognitoAuthorizeUrl(
  config: Pick<OAuthConfig, "cognitoDomain">,
  args: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string },
): string {
  const url = new URL("/oauth2/authorize", config.cognitoDomain);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: "openid email profile",
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    nonce: args.nonce,
    // Cognito 로그인 화면 없이 Google 로 바로 보낸다(앱과 같은 IdP).
    identity_provider: "Google",
    // 같은 PC 에서 서버 항목마다 다른 Google 계정을 고를 수 있게 매번 계정 선택을 띄운다.
    // login = Cognito 세션 쿠키가 있어도 재인증(IdP 로 다시 보냄), select_account = Google 로 전달돼 계정 선택 화면.
    // prompt 는 managed login(v2) 도메인에서만 동작한다 — classic hosted UI 는 무시한다.
    prompt: "login select_account",
  }).toString();
  return url.toString();
}

export function defaultCognitoOps(config: OAuthConfig): CognitoOps {
  let clientIdPromise: Promise<string> | null = null;
  let verifier: { clientId: string; v: ReturnType<typeof CognitoJwtVerifier.create> } | null = null;

  return {
    clientId() {
      if (config.cognitoClientId) return Promise.resolve(config.cognitoClientId);
      clientIdPromise ??= new SSMClient({})
        .send(new GetParameterCommand({ Name: config.cognitoClientIdParam }))
        .then((r) => {
          const value = r.Parameter?.Value;
          if (!value) throw new Error("oauth Cognito 클라이언트 ID 파라미터가 비어 있음");
          return value;
        })
        .catch((err) => {
          clientIdPromise = null; // 실패는 캐시하지 않는다.
          throw err;
        });
      return clientIdPromise;
    },

    async exchangeCode({ code, redirectUri, verifier: codeVerifier, clientId }) {
      const res = await fetch(new URL("/oauth2/token", config.cognitoDomain), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(COGNITO_TIMEOUT_MS),
      });
      // 응답 본문에는 토큰이 있을 수 있어 상태 코드만 남긴다.
      if (!res.ok) throw new Error(`Cognito 토큰 교환 실패(${res.status})`);
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== "string") throw new Error("Cognito 응답에 id_token 없음");
      return body.id_token;
    },

    async verifyIdToken(idToken, clientId) {
      if (verifier?.clientId !== clientId) {
        verifier = { clientId, v: CognitoJwtVerifier.create({ userPoolId: config.userPoolId, tokenUse: "id", clientId }) };
      }
      const payload = await verifier.v.verify(idToken);
      return { sub: payload.sub, nonce: typeof payload.nonce === "string" ? payload.nonce : undefined };
    },
  };
}
