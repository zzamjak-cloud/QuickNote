// CloudFront Function(viewer-request, cloudfront-js-2.0) — 요청자 IP 를 원본에 전달한다.
// CloudFront-Viewer-Address 는 관리형 AllViewerExceptHostHeader 원본 요청 정책에 포함되지 않으므로
// 뷰어 IP 를 x-qn-viewer-address("ip:port")로 싣는다. 클라이언트가 같은 헤더를 보내도 여기서 덮어쓴다.
// Lambda 는 origin-verify 헤더가 일치할 때(=CloudFront 경유)만 이 값을 신뢰한다.
function handler(event) {
  var request = event.request;
  var viewer = event.viewer || {};
  request.headers["x-qn-viewer-address"] = { value: (viewer.ip || "unknown") + ":0" };
  return request;
}
