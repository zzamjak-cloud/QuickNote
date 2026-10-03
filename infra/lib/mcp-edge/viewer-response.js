// CloudFront Function(viewer-response, cloudfront-js-2.0) — MCP 서버 응답 헤더 복원.
// Lambda Function URL 은 WWW-Authenticate 를 x-amzn-Remapped-WWW-Authenticate 로 바꿔 내보낸다.
// MCP 클라이언트는 401 의 WWW-Authenticate(resource_metadata)로 OAuth discovery 를 시작하므로 원래 이름으로 되돌린다.
// ⚠ CloudFront Functions 런타임: ES 모듈·require 불가, 파일 전체가 그대로 업로드된다(CDK 가 이 파일을 읽는다).
function handler(event) {
  var headers = event.response.headers;
  var remapped = headers["x-amzn-remapped-www-authenticate"];
  if (remapped) {
    headers["www-authenticate"] = { value: remapped.value };
    delete headers["x-amzn-remapped-www-authenticate"];
  }
  return event.response;
}
