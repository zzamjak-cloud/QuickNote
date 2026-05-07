// 일반 파일(동영상·PDF·zip 등) 업로드 후 fileBlock 노드 삽입.
// 이미지는 별도 image 노드를 사용 — 호출자가 mimeType 으로 분기.

import { uploadFile, type UploadedFile } from "../files/upload";
import { reportNonFatal } from "../reportNonFatal";

export type InsertFileAttrs = {
  src: string;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
};

export async function insertFileFromFile(
  file: File,
  insert: (attrs: InsertFileAttrs) => void,
): Promise<boolean> {
  try {
    const uploaded: UploadedFile = await uploadFile(file);
    insert({
      src: uploaded.ref,
      name: uploaded.name,
      size: uploaded.size,
      mime: uploaded.mimeType,
    });
    return true;
  } catch (err) {
    reportNonFatal(err, "insertFileFromFile");
    return false;
  }
}
