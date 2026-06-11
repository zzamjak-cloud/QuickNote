// 협업 room 식별자 파싱.
// 클라이언트는 "v<N>:<pageId>" / "db:v<N>:<dbId>" 형태로 epoch 솔트를 실어 보낸다.
// 연결 등록·Y 상태 저장 키는 풀 room 문자열을 그대로 사용해 세대(epoch)별로 격리하고,
// 권한 확인·시드 등 실제 엔티티 조회에만 솔트를 벗긴 id 를 사용한다.
// epoch 를 올리면(VITE_COLLAB_ROOM_EPOCH) 과거 세대의 stale 룸 상태가 자연 격리된다.
const ROOM_EPOCH_RE = /^v\d+:/;

export type Room = { kind: "page" | "database"; id: string };

/** room 식별자 파싱. "db:" prefix → database, 그 외 → page. epoch 솔트는 id 에서 제거한다. */
export function parseRoom(roomId: string): Room {
  if (roomId.startsWith("db:")) {
    return { kind: "database", id: roomId.slice(3).replace(ROOM_EPOCH_RE, "") };
  }
  return { kind: "page", id: roomId.replace(ROOM_EPOCH_RE, "") };
}
