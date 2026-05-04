import { putDatabaseFile, getDatabaseFile } from "./databaseFileStorage";
import { newId } from "./id";

/** TipTap image 노드에 넣는 투명 1×1 GIF — qnImageId 가 있으면 표시용 src 로만 쓰고 실제 픽셀은 IDB 에서 수화 */
export const EDITOR_IMAGE_PLACEHOLDER_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const PREFIX = "qn-img:";

function blobKey(id: string): string {
  return PREFIX + id;
}

/** 새 id 를 만들고 바이너리를 저장한다. 반환 id 는 노드 attrs.qnImageId 에만 넣는다. */
export async function storeEditorImageBlob(blob: Blob): Promise<string> {
  const id = newId();
  await putDatabaseFile(blobKey(id), blob);
  return id;
}

export async function loadEditorImageBlob(id: string): Promise<Blob | undefined> {
  return getDatabaseFile(blobKey(id));
}
