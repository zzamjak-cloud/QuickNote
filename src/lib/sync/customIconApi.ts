// 워크스페이스 공유 커스텀 아이콘 API 래퍼.

import { appsyncClient } from "./graphql/client";
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
  const res = (await appsyncClient().graphql({
    query: LIST_CUSTOM_ICONS,
    variables: { workspaceId },
  })) as { data?: { listCustomIcons?: GqlCustomIcon[] } };
  return res.data?.listCustomIcons ?? [];
}

export async function createCustomIconApi(input: {
  workspaceId: string;
  src: string;
  label: string;
}): Promise<GqlCustomIcon> {
  const res = (await appsyncClient().graphql({
    query: CREATE_CUSTOM_ICON,
    variables: { input },
  })) as { data?: { createCustomIcon?: GqlCustomIcon } };
  if (!res.data?.createCustomIcon) throw new Error("createCustomIcon 응답 없음");
  return res.data.createCustomIcon;
}

export async function deleteCustomIconApi(
  id: string,
  workspaceId: string,
): Promise<GqlCustomIcon> {
  const res = (await appsyncClient().graphql({
    query: DELETE_CUSTOM_ICON,
    variables: { id, workspaceId },
  })) as { data?: { deleteCustomIcon?: GqlCustomIcon } };
  if (!res.data?.deleteCustomIcon) throw new Error("deleteCustomIcon 응답 없음");
  return res.data.deleteCustomIcon;
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
