import { OidcClient, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { buildAuthConfig } from "./config";
import { zustandStorage } from "../storage/index";
import { AsyncStateStore } from "./asyncStateStore";

let _manager: UserManager | null = null;
let _client: OidcClient | null = null;
let _stateStore: AsyncStateStore | null = null;
let _userStore: AsyncStateStore | null = null;

function ensureStores() {
  if (!_stateStore) {
    _stateStore = new AsyncStateStore(zustandStorage, "quicknote.auth.state");
  }
  if (!_userStore) {
    _userStore = new AsyncStateStore(zustandStorage, "quicknote.auth.user");
  }
  return { stateStore: _stateStore, userStore: _userStore };
}

// UserManager 는 토큰 보관/갱신/콜백 처리용. silent renew(iframe) 는 비활성.
export function getOidcManager(): UserManager {
  if (_manager) return _manager;
  const cfg = buildAuthConfig();
  const { stateStore, userStore } = ensureStores();

  _manager = new UserManager({
    authority: cfg.authority,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    post_logout_redirect_uri: cfg.postLogoutRedirectUri,
    response_type: "code",
    scope: cfg.scope,
    automaticSilentRenew: false,
    loadUserInfo: false,
    monitorSession: false,
    extraQueryParams: { identity_provider: cfg.identityProvider },
    stateStore,
    userStore: userStore as unknown as WebStorageStateStore,
  });

  return _manager;
}

// OidcClient 는 외부 브라우저로 띄울 authorize URL 생성용.
// (UserManager.signinRedirect 는 항상 현재 창을 갈아끼우기 때문에 데스크톱에선 사용 불가.)
export function getOidcClient(): OidcClient {
  if (_client) return _client;
  const cfg = buildAuthConfig();
  const { stateStore } = ensureStores();

  _client = new OidcClient({
    authority: cfg.authority,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    post_logout_redirect_uri: cfg.postLogoutRedirectUri,
    response_type: "code",
    scope: cfg.scope,
    stateStore,
  });
  return _client;
}

export function resetOidcManager(): void {
  _manager = null;
  _client = null;
  _stateStore = null;
  _userStore = null;
}
