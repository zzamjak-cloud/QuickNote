// 서버(MCP Lambda)가 쓰는 협업 룸 epoch.
// ⚠ DEFAULT 는 src/lib/collab/collabConfig.ts collabRoomEpoch() 의 기본값과 같아야 한다(collab-epoch.test.ts 가 강제).
// 실제 배포 epoch 은 클라 번들의 VITE_COLLAB_ROOM_EPOCH(Vercel env·GitHub Secret)이 정한다.
// 환경별로 그 값을 아래 표에 고정해 수동 live 배포에서 epoch 누락(→ MCP 쓰기 EPOCH_MISMATCH 거부)을 막는다.
export const DEFAULT_COLLAB_ROOM_EPOCH = "v5";

/** envPrefix → 배포된 클라 epoch. live("") = Vercel Production·GitHub Secret VITE_COLLAB_ROOM_EPOCH. dev 는 미설정(기본값). */
export const DEPLOYED_COLLAB_ROOM_EPOCHS: Readonly<Record<string, string>> = {
  "": "v6",
};

/** 우선순위: 명시 override(env·context) > 환경별 표 > 기본값. */
export function resolveCollabRoomEpoch(envPrefix: string, override?: string): string {
  return override ?? DEPLOYED_COLLAB_ROOM_EPOCHS[envPrefix] ?? DEFAULT_COLLAB_ROOM_EPOCH;
}
