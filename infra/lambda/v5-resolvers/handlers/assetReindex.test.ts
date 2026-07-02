import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { migrateAssetUsage } from "./asset";
import type { Tables } from "./member";

// AssetUsage 증분 재인덱싱 회귀 — 체크포인트 read/write, 증분 FilterExpression, 전체 폴백.
const tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  AssetUsage: "AU",
  // CustomIcons 미지정 → 아이콘 재인덱싱은 즉시 0 반환(스캔 없음)으로 테스트 단순화.
} as unknown as Tables;

const caller = { memberId: "m1", cognitoSub: "sub-1" };

function makeDoc(checkpoint?: string) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const doc = {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === "GetCommand") {
        return checkpoint ? { Item: { lastReindexAt: checkpoint } } : {};
      }
      if (name === "ScanCommand") return { Items: [], LastEvaluatedKey: undefined };
      return {}; // PutCommand 등
    }),
  };
  return { doc: doc as unknown as DynamoDBDocumentClient, sent };
}

const pagesScan = (sent: Array<{ name: string; input: Record<string, unknown> }>) =>
  sent.find((c) => c.name === "ScanCommand" && c.input.TableName === "P");
const putCmd = (sent: Array<{ name: string; input: Record<string, unknown> }>) =>
  sent.find((c) => c.name === "PutCommand");

describe("migrateAssetUsage 증분 재인덱싱", () => {
  it("체크포인트 없으면 전체 스캔(FilterExpression 없음)으로 폴백하고 체크포인트를 남긴다", async () => {
    const { doc, sent } = makeDoc(undefined);
    const res = await migrateAssetUsage({ doc, tables, caller, incremental: true });
    expect(res.mode).toBe("full");
    expect(res.hasMore).toBe(false);
    expect(pagesScan(sent)?.input.FilterExpression).toBeUndefined();
    const put = putCmd(sent);
    const item = put?.input.Item as Record<string, unknown> | undefined;
    expect(item?.assetId).toBe("__reindex_checkpoint__");
    expect(item?.sk).toBe("sub-1");
    expect(typeof item?.lastReindexAt).toBe("string");
    // byOwner/byPage GSI 오염 방지 — ownerId/pageId 속성이 없어야 한다.
    expect(item?.ownerId).toBeUndefined();
    expect(item?.pageId).toBeUndefined();
  });

  it("체크포인트가 있으면 updatedAt > since 로 증분 스캔한다", async () => {
    const cp = "2026-06-01T00:00:00.000Z";
    const { doc, sent } = makeDoc(cp);
    const res = await migrateAssetUsage({ doc, tables, caller, incremental: true });
    expect(res.mode).toBe("incremental");
    const scan = pagesScan(sent);
    expect(scan?.input.FilterExpression).toBe("#u > :since");
    expect((scan?.input.ExpressionAttributeValues as Record<string, unknown>)[":since"]).toBe(cp);
  });

  it("incremental=false 는 체크포인트가 있어도 전체 스캔한다", async () => {
    const { doc, sent } = makeDoc("2026-06-01T00:00:00.000Z");
    const res = await migrateAssetUsage({ doc, tables, caller, incremental: false });
    expect(res.mode).toBe("full");
    expect(pagesScan(sent)?.input.FilterExpression).toBeUndefined();
    // 전체 모드도 완료 시 체크포인트를 남겨 다음 증분의 기준선이 된다.
    expect(putCmd(sent)).toBeTruthy();
  });
});
