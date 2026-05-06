import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import { readStoredTokens } from "../../auth/tokenStore";

// Amplify v6 GraphQL 클라이언트 구성. Cognito User Pool JWT 를 헤더로 주입.

let configured = false;

export function configureAppSync(): void {
  if (configured) return;
  const endpoint = import.meta.env.VITE_APPSYNC_ENDPOINT as string | undefined;
  const region =
    (import.meta.env.VITE_COGNITO_REGION as string | undefined) ?? "ap-northeast-2";
  if (!endpoint) {
    throw new Error("VITE_APPSYNC_ENDPOINT not set");
  }

  // Amplify v6 의 두 번째 인자(library options) 타입은 너무 깊어 TS 추론이
  // 폭발한다. 의도적으로 unknown 으로 cast 한다.
  const resourcesConfig = {
    API: {
      GraphQL: {
        endpoint,
        region,
        defaultAuthMode: "userPool",
      },
    },
  };
  const libraryOptions = {
    API: {
      GraphQL: {
        headers: async () => {
          const tokens = await readStoredTokens();
          return tokens ? { Authorization: tokens.idToken } : {};
        },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Amplify.configure as any)(resourcesConfig, libraryOptions);
  configured = true;
}

// generateClient 의 반환 타입이 너무 깊어 TS 추론이 폭발한다. unknown 캐스팅 사용.
type AppSyncClient = {
  graphql: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<unknown> | unknown;
};

let _client: AppSyncClient | null = null;
export function appsyncClient(): AppSyncClient {
  if (!_client) {
    configureAppSync();
    _client = generateClient() as unknown as AppSyncClient;
  }
  return _client;
}
