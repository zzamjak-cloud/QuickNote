/**
 * 삭제 확인 문구 비교용 정규화.
 *
 * macOS·Google Drive 는 한글 파일/폴더명을 NFD(자모 분리형)로 저장하므로,
 * 노션 임포트로 만들어진 DB 제목이 NFD 인 경우가 많다. 사용자가 한글 키보드로
 * 입력하면 NFC(완성형)라서 화면상 동일해도 코드포인트가 달라 문자열 비교가 실패한다.
 * → NFC 정규화 + zero-width/방향표시 문자 제거 + 공백 정규화로 양쪽을 수렴시킨다.
 */

// zero-width space(200B)·ZWNJ(200C)·ZWJ(200D)·LTR(200E)·RTL(200F)·soft hyphen(00AD)·BOM(FEFF)
// 문자 클래스 대신 alternation 사용 — ZWJ 가 인접 문자와 결합 시퀀스로 오인되는 lint 경고 방지.
const INVISIBLE_CHARS = new RegExp(
  "\\u200B|\\u200C|\\u200D|\\u200E|\\u200F|\\u00AD|\\uFEFF",
  "g",
);

export function normalizeConfirmPhrase(value: string): string {
  return value
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    // 모든 공백류(NBSP 포함 — JS \s 가 커버)를 단일 스페이스로
    .replace(/\s+/g, " ")
    .trim();
}
