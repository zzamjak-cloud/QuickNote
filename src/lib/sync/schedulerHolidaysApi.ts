// LC 스케줄러 공휴일 AppSync 호출 — store 에서 분리(5.1).
// 호출 형태는 보존(직접 graphql, outbox 비경유). store 는 이 함수를 호출하고 캐시·정규화를 담당.
import { appsyncClient } from "./graphql/client";
import {
  LIST_HOLIDAYS,
  CREATE_HOLIDAY,
  UPDATE_HOLIDAY,
  DELETE_HOLIDAY,
  type GqlHoliday,
} from "./graphql/operations";
import type {
  CreateHolidayInput,
  UpdateHolidayInput,
} from "../../store/schedulerHolidaysStore";
import { runSchedulerMutation } from "./schedulerMutationResilience";

export async function listHolidaysApi(workspaceId: string): Promise<GqlHoliday[]> {
  const r = await (appsyncClient().graphql({
    query: LIST_HOLIDAYS,
    variables: { workspaceId },
  }) as Promise<{ data: { listHolidays: GqlHoliday[] } }>);
  return r.data.listHolidays;
}

export async function createHolidayApi(input: CreateHolidayInput): Promise<GqlHoliday> {
  // create 는 비멱등 — 재시도 시 중복 생성 위험이라 관측만.
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: CREATE_HOLIDAY,
      variables: { input },
    }) as Promise<{ data: { createHoliday: GqlHoliday } }>);
    return r.data.createHoliday;
  }, { context: "schedulerHolidaysApi.createHoliday", retryable: false });
}

export async function updateHolidayApi(input: UpdateHolidayInput): Promise<GqlHoliday> {
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: UPDATE_HOLIDAY,
      variables: { input },
    }) as Promise<{ data: { updateHoliday: GqlHoliday } }>);
    return r.data.updateHoliday;
  }, { context: "schedulerHolidaysApi.updateHoliday", retryable: true });
}

export async function deleteHolidayApi(id: string, workspaceId: string): Promise<void> {
  await runSchedulerMutation(async () => {
    await appsyncClient().graphql({
      query: DELETE_HOLIDAY,
      variables: { id, workspaceId },
    });
  }, { context: "schedulerHolidaysApi.deleteHoliday", retryable: true });
}
