import * as Y from "yjs";

// 여러 update 바이트를 하나의 머지된 상태 update로 합친다.
export function mergeState(updates: Uint8Array[]): Uint8Array {
  return Y.mergeUpdates(updates);
}

// 머지된 서버 상태와 클라 state vector로 "클라가 모르는 변경"만 추출.
export function diffForClient(serverState: Uint8Array, clientStateVector: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState);
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}

// 머지된 서버 상태의 state vector.
export function stateVectorOf(serverState: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, serverState);
  return Y.encodeStateVector(doc);
}

// 빈 Y.Doc 상태(최초 시드 폴백). 실제 본문 시드는 첫 클라이언트의 sv-reply로 채운다.
export function emptyState(): Uint8Array {
  return Y.encodeStateAsUpdate(new Y.Doc());
}
