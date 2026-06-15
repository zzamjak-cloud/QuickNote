// 워크스페이스 공유 커스텀 아이콘 API 래퍼.

import { appsyncClient } from "./graphql/client";
import { gqlOptional, gqlRequired } from "./graphqlRequest";
import {
  LIST_CUSTOM_ICONS,
  CREATE_CUSTOM_ICON,
  DELETE_CUSTOM_ICON,
  ON_CUSTOM_ICON_CHANGED,
  type GqlCustomIcon,
} from "./graphql/operations";

type Subscribable = {
  subscribe: (h: {
    next: (msg: { data: Record<string, unknown> }) => void;
    error: (e: unknown) => void;
  }) => { unsubscribe: () => void };
};

export async function listCustomIconsApi(workspaceId: string): Promise<GqlCustomIcon[]> {
  const icons = await gqlOptional<GqlCustomIcon[]>(
    LIST_CUSTOM_ICONS,
    { workspaceId },
    "listCustomIcons",
  );
  return icons ?? [];
}

export async function createCustomIconApi(input: {
  workspaceId: string;
  src: string;
  label: string;
}): Promise<GqlCustomIcon> {
  return gqlRequired<GqlCustomIcon>(CREATE_CUSTOM_ICON, { input }, "createCustomIcon");
}

export async function deleteCustomIconApi(
  id: string,
  workspaceId: string,
): Promise<GqlCustomIcon> {
  return gqlRequired<GqlCustomIcon>(
    DELETE_CUSTOM_ICON,
    { id, workspaceId },
    "deleteCustomIcon",
  );
}

/**
 * 워크스페이스의 커스텀 아이콘 변경 push 를 수신.
 * 단순화를 위해 onEvent 콜백만 호출 — 호출자는 보통 listCustomIcons 재호출로 동기화한다.
 */
export function subscribeCustomIcons(
  workspaceId: string,
  onEvent: (icon: GqlCustomIcon) => void,
  onError?: (e: unknown) => void,
): { unsubscribe: () => void } {
  const obs = appsyncClient().graphql({
    query: ON_CUSTOM_ICON_CHANGED,
    variables: { workspaceId },
  } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
  return obs.subscribe({
    next: ({ data }) => {
      const icon = (data as { onCustomIconChanged?: GqlCustomIcon }).onCustomIconChanged;
      if (icon && icon.id) onEvent(icon);
    },
    error: (e) => {
      console.warn("[customIcon subscription] error", e);
      onError?.(e);
    },
  });
}
