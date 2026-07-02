import { describe, it, expect } from "vitest";
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { deleteWorkspace } from "../workspace";
import type { Member } from "../_auth";
import type { Tables } from "../member";

// 회귀: deleteWorkspace 가 위성 데이터(Comments/Page·DatabaseHistory/CustomIcons/
// Holidays/Projects/MmEntries/AssetUsage)를 정리하지 않아 고아 행이 축적되던 문제.
// (없으면 고아 AssetUsage 가 자산을 영구 "사용 중"으로 만들어 image-gc 오염)

const WS = "ws-1";

const TABLES: Tables = {
  Workspaces: "T_Workspaces",
  WorkspaceAccess: "T_WorkspaceAccess",
  MemberTeams: "T_MemberTeams",
  Pages: "T_Pages",
  Databases: "T_Databases",
  Comments: "T_Comments",
  Notifications: "T_Notifications",
  Projects: "T_Projects",
  Holidays: "T_Holidays",
  MmEntries: "T_MmEntries",
  AssetUsage: "T_AssetUsage",
  CustomIcons: "T_CustomIcons",
  PageHistory: "T_PageHistory",
  DatabaseHistory: "T_DatabaseHistory",
} as unknown as Tables;

const caller = {
  memberId: "m1",
  workspaceRole: "owner",
} as unknown as Member;

/** 테이블별로 GSI 조회 시 돌려줄 아이템 한 건씩 심어두는 가짜 doc client. */
function makeFakeDoc() {
  const deletedByTable: Record<string, unknown[]> = {};
  const record = (table: string, key: unknown) => {
    (deletedByTable[table] ??= []).push(key);
  };

  const queryItem = (input: { TableName?: string; IndexName?: string }) => {
    switch (input.TableName) {
      case TABLES.WorkspaceAccess:
        return [{ workspaceId: WS, subjectKey: "member#m1" }];
      case TABLES.Pages:
        return [{ id: "p1", workspaceId: WS }];
      case TABLES.Databases:
        return [{ id: "d1", workspaceId: WS }];
      case TABLES.Comments:
        return [{ id: "c1", workspaceId: WS }];
      case TABLES.CustomIcons:
        return [{ id: "ic1", workspaceId: WS }];
      case TABLES.PageHistory:
        return [{ pageId: "p1", historyId: "h1", workspaceId: WS }];
      case TABLES.DatabaseHistory:
        return [{ databaseId: "d1", historyId: "h1", workspaceId: WS }];
      case TABLES.Holidays:
        return [{ id: "ho1", workspaceId: WS }];
      case TABLES.Projects:
        return [{ id: "pr1", workspaceId: WS }];
      case TABLES.MmEntries:
        return [{ id: "mm1", workspaceId: WS }];
      case TABLES.AssetUsage:
        // asset.ts cascadeDeletePageAssetUsage 의 byPage 조회
        return [{ assetId: "a1", sk: "p1#b1" }];
      default:
        return [];
    }
  };

  const doc = {
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        // getWorkspaceRow
        return { Item: { workspaceId: WS, name: "WS", type: "shared" } };
      }
      if (command instanceof QueryCommand) {
        return { Items: queryItem(command.input) };
      }
      if (command instanceof BatchWriteCommand) {
        const req = command.input.RequestItems ?? {};
        for (const [table, reqs] of Object.entries(req)) {
          for (const r of reqs as Array<{ DeleteRequest?: { Key: unknown } }>) {
            if (r.DeleteRequest) record(table, r.DeleteRequest.Key);
          }
        }
        return {};
      }
      if (command instanceof DeleteCommand) {
        record(command.input.TableName as string, command.input.Key);
        return {};
      }
      return {};
    },
  };

  return { doc, deletedByTable };
}

describe("deleteWorkspace cascade", () => {
  it("모든 위성 테이블의 워크스페이스 데이터를 삭제한다", async () => {
    const { doc, deletedByTable } = makeFakeDoc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await deleteWorkspace({ doc: doc as any, tables: TABLES, caller, workspaceId: WS });
    expect(ok).toBe(true);

    // 핵심: 위성 테이블 각각에 대해 삭제가 발생했는지 검증(누락 시 고아 축적).
    for (const table of [
      TABLES.WorkspaceAccess,
      TABLES.Pages,
      TABLES.Databases,
      TABLES.Comments,
      TABLES.CustomIcons,
      TABLES.PageHistory,
      TABLES.DatabaseHistory,
      TABLES.Holidays,
      TABLES.Projects,
      TABLES.MmEntries,
      TABLES.AssetUsage,
      TABLES.Workspaces,
    ]) {
      expect(deletedByTable[table as string], `${table} 삭제 누락`).toBeDefined();
      expect((deletedByTable[table as string] ?? []).length).toBeGreaterThan(0);
    }
  });

  it("복합키 테이블은 base PK(+SK)로 삭제한다", async () => {
    const { doc, deletedByTable } = makeFakeDoc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deleteWorkspace({ doc: doc as any, tables: TABLES, caller, workspaceId: WS });

    expect(deletedByTable[TABLES.PageHistory as string][0]).toEqual({
      pageId: "p1",
      historyId: "h1",
    });
    expect(deletedByTable[TABLES.Holidays as string][0]).toEqual({ id: "ho1", workspaceId: WS });
    expect(deletedByTable[TABLES.AssetUsage as string][0]).toEqual({ assetId: "a1", sk: "p1#b1" });
  });
});
