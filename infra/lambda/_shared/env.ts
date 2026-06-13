// Lambda 핸들러 공용 환경변수 헬퍼.
// 미설정(undefined) 또는 빈 문자열이면 throw 하여 잘못된 배포를 조기에 차단한다.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`env ${name} not set`);
  return value;
}
