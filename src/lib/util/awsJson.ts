// AppSync AWSJSON write 측 직렬화 헬퍼.
// read 측 정규화는 storeApply/helpers.ts 의 parseAwsJson 이 단일 담당한다(여기 없음).
//
// 동작: nullish → null, 이미 string → 그대로 통과(이중 인코딩 방지),
//      그 외 → JSON.stringify, 직렬화 실패 시 null.
// 필드 선택/폴백 값은 각 호출처가 책임진다. 이 함수는 "값 → 문자열" 변환만 한다.
export function stringifyAwsJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
