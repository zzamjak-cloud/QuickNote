/* eslint-disable @typescript-eslint/no-explicit-any */
// AppSync APPSYNC_JS 런타임에서 실행되는 owner-scoped LWW 헬퍼.
// 각 entry 파일(upsert/softDelete/list/subscribe)이 이 모듈을 import 하고
// request/response 함수를 re-export 한다. esbuild 가 entry 별로 번들한다.
//
// AppSync JS 리졸버 컨텍스트는 런타임이 동적으로 주입하므로 정확한 타입을
// 표현하기 어렵다. 본 파일은 의도적으로 any 를 사용한다.

import { util } from "@aws-appsync/utils";

type Ctx = any;

export function requireSub(ctx: Ctx): string {
  const sub = ctx.identity?.sub;
  if (!sub) util.unauthorized();
  return sub as string;
}

export function lwwUpsertRequest(ctx: Ctx) {
  const sub = requireSub(ctx);
  const input = ctx.args.input;
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ id: input.id }),
    attributeValues: util.dynamodb.toMapValues({
      ...input,
      ownerId: sub,
      deletedAt: null,
    }),
    condition: {
      expression: "attribute_not_exists(updatedAt) OR :new > #u",
      expressionNames: { "#u": "updatedAt" },
      expressionValues: util.dynamodb.toMapValues({ ":new": input.updatedAt }),
    },
  };
}

export function lwwResponse(ctx: Ctx) {
  if (ctx.error) {
    // 조건 실패 = 서버가 더 최신. LWW 에서는 정상이므로 현재 본을 그대로 반환.
    if (ctx.error.type === "DynamoDB:ConditionalCheckFailedException") {
      return ctx.result;
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

export function lwwSoftDeleteRequest(ctx: Ctx) {
  const sub = requireSub(ctx);
  const now = util.time.nowISO8601();
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    update: {
      expression: "SET deletedAt = :now, updatedAt = :now",
      expressionValues: util.dynamodb.toMapValues({ ":now": now }),
    },
    condition: {
      expression:
        "ownerId = :sub AND (attribute_not_exists(updatedAt) OR :new > #u)",
      expressionNames: { "#u": "updatedAt" },
      expressionValues: util.dynamodb.toMapValues({
        ":sub": sub,
        ":new": ctx.args.updatedAt,
      }),
    },
  };
}

export function listOwnerScopedRequest(ctx: Ctx) {
  const sub = requireSub(ctx);
  const updatedAfter = ctx.args.updatedAfter as string | undefined;
  const limit = (ctx.args.limit as number | undefined) ?? 100;
  if (updatedAfter) {
    return {
      operation: "Query",
      index: "byOwner",
      query: {
        expression: "ownerId = :sub AND updatedAt > :after",
        expressionValues: util.dynamodb.toMapValues({
          ":sub": sub,
          ":after": updatedAfter,
        }),
      },
      limit,
      nextToken: ctx.args.nextToken,
    };
  }
  return {
    operation: "Query",
    index: "byOwner",
    query: {
      expression: "ownerId = :sub",
      expressionValues: util.dynamodb.toMapValues({ ":sub": sub }),
    },
    limit,
    nextToken: ctx.args.nextToken,
  };
}

export function listResponse(ctx: Ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return { items: ctx.result.items, nextToken: ctx.result.nextToken };
}

export function subscriptionRequest(ctx: Ctx) {
  const sub = requireSub(ctx);
  if (ctx.args.ownerId !== sub) util.unauthorized();
  return { payload: null };
}

export function subscriptionResponse(ctx: Ctx) {
  return ctx.result;
}
