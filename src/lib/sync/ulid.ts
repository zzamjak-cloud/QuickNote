// 단조 증가 시간 prefix + 랜덤 80bit 의 26자 base32. 충돌 안전성 충분.

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 9; i >= 0; i--) {
    timeStr = ENC[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  let rand = "";
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 16; i++) rand += ENC[arr[i]! % 32];
  return timeStr + rand;
}
