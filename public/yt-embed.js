// 데스크톱(Tauri) 앱의 유튜브 오류 153(Referer 부재) 회피용 임베드 래퍼.
// tauri://localhost 문서에서는 Referer 가 전송되지 않아 유튜브가 임베드를 거부하므로,
// https 출처인 이 페이지를 한 겹 끼워 내부 iframe 요청에 Referer 가 실리게 한다.
// 열린 프록시가 되지 않도록 유튜브 embed URL 만 허용한다.
(function () {
  "use strict";
  var raw = new URLSearchParams(window.location.search).get("src") || "";
  var url = null;
  try {
    url = new URL(raw);
  } catch (e) {
    url = null;
  }
  var originOk =
    url !== null &&
    (url.origin === "https://www.youtube.com" ||
      url.origin === "https://www.youtube-nocookie.com");
  var pathOk = url !== null && url.pathname.indexOf("/embed/") === 0;
  if (!originOk || !pathOk) {
    var p = document.createElement("p");
    p.textContent = "유효하지 않은 동영상 주소입니다.";
    document.body.appendChild(p);
    return;
  }
  var frame = document.createElement("iframe");
  frame.src = url.toString();
  frame.title = "YouTube video";
  frame.allowFullscreen = true;
  frame.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; compute-pressure; encrypted-media; gyroscope; picture-in-picture; web-share"
  );
  document.body.appendChild(frame);
})();
