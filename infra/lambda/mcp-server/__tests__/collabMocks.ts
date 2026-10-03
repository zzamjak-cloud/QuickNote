// 쓰기 테스트 공용 목 — 협업 룸 저장소(yjsStore)·브로드캐스트·AppSync 발행을 메모리로 대체한다.
// 사용: vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock) 등.
import { vi } from "vitest";
import * as Y from "yjs";
import { buildSeedUpdate, schemaFromSpec, type DocJson } from "../../_shared/collabContent";
import { resetEpochCache } from "../epochGuard";

export const rooms = new Map<string, Uint8Array>();
export const appended: { room: string; update: Uint8Array }[] = [];

const EMPTY = Y.encodeStateAsUpdate(new Y.Doc());

export const yjsStoreMock = {
  loadPageState: vi.fn(async (room: string) => rooms.get(room) ?? EMPTY),
  appendPageUpdate: vi.fn(async (room: string, update: Uint8Array) => {
    appended.push({ room, update });
    rooms.set(room, Y.mergeUpdates([rooms.get(room) ?? EMPTY, update]));
  }),
};

export const broadcastMock = {
  broadcastRoomUpdate: vi.fn(async () => ({ connections: 2, delivered: 2, gone: 0 })),
};

export const publishMock = {
  publishPage: vi.fn(async (_page: unknown, _opts?: { deletedAt?: string }) => true),
  publishDatabase: vi.fn(async (_db: unknown) => true),
  publishComment: vi.fn(async (_comment: unknown) => true),
};

/** 클라 시드와 같은 방식으로 룸에 본문을 채운다(룸이 비어 있지 않은 페이지 시나리오). */
export function seedRoom(room: string, doc: DocJson): void {
  rooms.set(room, buildSeedUpdate(schemaFromSpec(), doc));
}

export function resetCollabMocks(): void {
  rooms.clear();
  appended.length = 0;
  resetEpochCache();
  yjsStoreMock.loadPageState.mockClear();
  yjsStoreMock.appendPageUpdate.mockClear();
  broadcastMock.broadcastRoomUpdate.mockClear();
  publishMock.publishPage.mockClear();
  publishMock.publishDatabase.mockClear();
  publishMock.publishComment.mockClear();
}

export function para(text: string, id?: string): DocJson {
  return { type: "paragraph", ...(id ? { attrs: { id } } : {}), content: [{ type: "text", text }] };
}

export function docOf(...blocks: DocJson[]): DocJson {
  return { type: "doc", content: blocks };
}
