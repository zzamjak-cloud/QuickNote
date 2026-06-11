// 협업 모드 에디터 편집 허용 판정(순수 함수).
// 서버가 sync 됐거나, 로컬(IndexedDB)에서 콘텐츠 있는 doc 이 복원되면 편집 허용.
// 첫 방문 + 오프라인(로컬 비어있고 서버 미연결)에서는 빈 doc 오편집을 막기 위해 차단.
export type CollabGatingInput = {
  synced: boolean;
  idbLoaded: boolean;
  docNotEmpty: boolean;
};

export function canEditCollab({ synced, idbLoaded, docNotEmpty }: CollabGatingInput): boolean {
  return synced || (idbLoaded && docNotEmpty);
}
