// 서버(MCP Lambda)가 쓰는 협업 룸 epoch 기본값.
// ⚠ src/lib/collab/collabConfig.ts collabRoomEpoch() 의 기본값과 같아야 한다(collab-epoch.test.ts 가 강제).
// 실제 배포 epoch 은 Vercel env·GitHub Secret 의 VITE_COLLAB_ROOM_EPOCH 이 정하므로, 그 값을 바꾸면
// CDK 배포 시 COLLAB_ROOM_EPOCH env 또는 `-c collabRoomEpoch=` 로 같은 값을 넘기거나 이 기본값을 함께 올린다.
export const DEFAULT_COLLAB_ROOM_EPOCH = "v5";
