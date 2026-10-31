import { describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { WORKSPACE_DELETE_IN_PROGRESS, deleteWorkspaceCascade } from "./workspaceDelete";
import type { Tables } from "./member";

const tables = { Workspaces: "W", WorkspaceAccess: "WA", PageHistory: "PH" } as unknown as Tables;
const noSleep = async () => {};

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

function docWith(handler: (cmd: Cmd) => unknown) {
  const send = vi.fn(async (cmd: Cmd) => handler(cmd));
  return { doc: { send } as unknown as DynamoDBDocumentClient, send };
}

const historyItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ pageId: `p${i}`, historyId: `h${i}`, workspaceId: "ws" }));

describe("deleteWorkspaceCascade", () => {
  it("스로틀링·UnprocessedItems 를 재시도해 모두 지운 뒤 워크스페이스 행을 삭제한다", async () => {
    let throttled = false;
    let unprocessedReturned = false;
    const deleted: unknown[] = [];
    const { doc, send } = docWith((cmd) => {
      const name = cmd.constructor.name;
      if (name === "QueryCommand") {
        return { Items: cmd.input.TableName === "PH" ? historyItems(30) : [] };
      }
      if (name === "BatchWriteCommand") {
        const reqs = (cmd.input.RequestItems as Record<string, Array<{ DeleteRequest: unknown }>>).PH;
        if (!throttled) {
          throttled = true;
          throw Object.assign(new Error("throttle"), { name: "ThrottlingException" });
        }
        if (!unprocessedReturned) {
          unprocessedReturned = true;
          deleted.push(...reqs.slice(1));
          return { UnprocessedItems: { PH: reqs.slice(0, 1) } };
        }
        deleted.push(...reqs);
        return {};
      }
      return {};
    });

    await deleteWorkspaceCascade({ doc, tables, workspaceId: "ws", sleep: noSleep });

    expect(deleted).toHaveLength(30);
    const last = send.mock.calls.at(-1)?.[0] as Cmd;
    expect(last.constructor.name).toBe("DeleteCommand");
    expect(last.input.Key).toEqual({ workspaceId: "ws" });
  });

  it("예산을 넘기면 워크스페이스 행을 남긴 채 진행 중 오류를 던진다", async () => {
    const { doc, send } = docWith(() => ({ Items: [] }));
    await expect(
      deleteWorkspaceCascade({ doc, tables, workspaceId: "ws", budgetMs: -1, sleep: noSleep }),
    ).rejects.toThrow(WORKSPACE_DELETE_IN_PROGRESS);
    const names = send.mock.calls.map((c) => (c[0] as Cmd).constructor.name);
    expect(names).not.toContain("DeleteCommand");
  });

  it("스로틀이 아닌 오류는 그대로 전파한다", async () => {
    const { doc } = docWith((cmd) => {
      if (cmd.constructor.name === "QueryCommand") return { Items: historyItems(1) };
      throw Object.assign(new Error("boom"), { name: "ValidationException" });
    });
    await expect(deleteWorkspaceCascade({ doc, tables, workspaceId: "ws", sleep: noSleep })).rejects.toThrow("boom");
  });
});
