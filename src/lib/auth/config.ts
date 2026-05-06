// Cognito + Google OAuth 설정. Tauri 데스크톱과 웹의 redirect URI / client id 가 다르다.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type AuthRuntime = "web" | "desktop";

export type AuthConfig = {
  runtime: AuthRuntime;
  region: string;
  userPoolId: string;
  hostedUiDomain: string; // ex) quicknote-auth.auth.ap-northeast-2.amazoncognito.com
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  authority: string; // OIDC issuer
  scope: string;
  // Hosted UI 가 Cognito 의 자체 가입 폼 대신 Google 로 바로 가도록 강제할 때 사용.
  identityProvider: "Google";
};

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`auth: 필수 환경변수 ${name} 가 비어 있습니다.`);
  }
  return value;
}

export function buildAuthConfig(): AuthConfig {
  const runtime: AuthRuntime = isTauri ? "desktop" : "web";
  const env = import.meta.env;

  const region = required("VITE_COGNITO_REGION", env.VITE_COGNITO_REGION);
  const userPoolId = required(
    "VITE_COGNITO_USER_POOL_ID",
    env.VITE_COGNITO_USER_POOL_ID,
  );
  const hostedUiDomain = required(
    "VITE_COGNITO_HOSTED_UI_DOMAIN",
    env.VITE_COGNITO_HOSTED_UI_DOMAIN,
  );

  const clientId =
    runtime === "desktop"
      ? required(
          "VITE_COGNITO_DESKTOP_CLIENT_ID",
          env.VITE_COGNITO_DESKTOP_CLIENT_ID,
        )
      : required(
          "VITE_COGNITO_WEB_CLIENT_ID",
          env.VITE_COGNITO_WEB_CLIENT_ID,
        );

  const redirectUri =
    runtime === "desktop"
      ? required("VITE_AUTH_REDIRECT_DESKTOP", env.VITE_AUTH_REDIRECT_DESKTOP)
      : required("VITE_AUTH_REDIRECT_WEB", env.VITE_AUTH_REDIRECT_WEB);

  return {
    runtime,
    region,
    userPoolId,
    hostedUiDomain,
    clientId,
    redirectUri,
    postLogoutRedirectUri: redirectUri.replace(/\/auth\/callback$/, "/auth/signout"),
    authority: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    scope: "openid email profile",
    identityProvider: "Google",
  };
}
