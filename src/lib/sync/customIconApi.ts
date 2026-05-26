// 워크스페이스 공유 커스텀 아이콘 API 래퍼.

import { appsyncClient } from "./graphql/client";
import {
  LIST_CUSTOM_ICONS,
  CREATE_CUSTOM_ICON,
  DELETE_CUSTOM_ICON,
  type GqlCustomIcon,
} from "./graphql/operations";

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
