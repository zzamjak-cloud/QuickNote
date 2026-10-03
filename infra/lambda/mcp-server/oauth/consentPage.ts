// 서버 렌더 동의·오류 페이지 — 스크립트·외부 자산 없음. 인라인 CSS 는 해시로만 허용(CSP 'unsafe-inline' 없음).
import { createHash } from "node:crypto";
import { escapeHtml, html, type Result } from "./http";

const CSS = `body{font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#f4f4f5;color:#18181b;margin:0;padding:24px 16px}
main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:24px}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.5;margin:8px 0}.muted{color:#71717a;font-size:12px}
fieldset{border:1px solid #e4e4e7;border-radius:8px;margin:16px 0 0;padding:8px 12px}legend{font-size:13px;font-weight:600;padding:0 4px}
label{display:flex;gap:8px;align-items:center;font-size:14px;padding:4px 0}.warn{color:#b45309;font-size:12px}
.actions{display:flex;gap:8px;margin-top:20px}button{flex:1;min-height:44px;border-radius:8px;font-size:14px;cursor:pointer;border:1px solid #d4d4d8;background:#fff}
button.primary{background:#7c3aed;border-color:#7c3aed;color:#fff}
@media (prefers-color-scheme:dark){body{background:#18181b;color:#f4f4f5}main{background:#27272a;border-color:#3f3f46}fieldset{border-color:#3f3f46}button{background:#3f3f46;color:#f4f4f5;border-color:#52525b}}`;

const STYLE_HASH = createHash("sha256").update(CSS, "utf8").digest("base64");

/** form-action 은 리다이렉트 대상에도 적용되므로(Chrome) 승인 후 이동할 클라이언트 origin 을 함께 허용한다. */
function csp(formActionOrigin?: string): string {
  const formAction = formActionOrigin ? `'self' ${formActionOrigin}` : "'none'";
  return [
    "default-src 'none'",
    `style-src 'sha256-${STYLE_HASH}'`,
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${inner}</main></body></html>`;
}

export function errorPage(status: number, message: string, cookies?: string[]): Result {
  return html(
    status,
    page("QuickNote 연결 오류", `<h1>연결할 수 없습니다</h1><p>${escapeHtml(message)}</p><p class="muted">AI 앱에서 연결을 다시 시도해 주세요.</p>`),
    csp(),
    cookies,
  );
}

export type ConsentView = {
  txId: string;
  csrf: string;
  clientName: string;
  redirectUri: string;
  memberEmail: string;
  requestedScopes: string[];
  workspaces: { id: string; name: string }[];
};

export function consentPage(view: ConsentView): Result {
  const redirect = new URL(view.redirectUri);
  const wantsWrite = view.requestedScopes.includes("write");
  const scopeField = wantsWrite
    ? `<label><input type="radio" name="scope" value="write" checked> 읽기 + 쓰기</label>
<label><input type="radio" name="scope" value="read"> 읽기만</label>
<p class="warn">쓰기를 허용하면 페이지 생성·편집·휴지통 이동을 할 수 있습니다(영구삭제 불가).</p>`
    : `<label><input type="radio" name="scope" value="read" checked> 읽기</label>`;
  const workspaceField = view.workspaces
    .map((w) => `<label><input type="checkbox" name="workspaceIds" value="${escapeHtml(w.id)}"> ${escapeHtml(w.name)}</label>`)
    .join("");

  const inner = `<h1>QuickNote 연결 승인</h1>
<p><strong>${escapeHtml(view.clientName)}</strong> 이(가) <strong>${escapeHtml(view.memberEmail)}</strong> 계정의 QuickNote 에 접근하려고 합니다.</p>
<p class="muted">승인하면 ${escapeHtml(redirect.host)} 로 이동합니다. 모르는 앱이면 거부하세요.</p>
<form method="post" action="/consent">
<input type="hidden" name="tx" value="${escapeHtml(view.txId)}">
<input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<fieldset><legend>권한</legend>${scopeField}</fieldset>
<fieldset><legend>워크스페이스</legend>${workspaceField}<p class="muted">선택하지 않으면 접근 가능한 전체 워크스페이스에 연결됩니다.</p></fieldset>
<fieldset><legend>연결 유지 기간</legend>
<label><input type="radio" name="expiryDays" value="30" checked> 30일</label>
<label><input type="radio" name="expiryDays" value="90"> 90일</label></fieldset>
<div class="actions"><button type="submit" name="action" value="deny">거부</button><button class="primary" type="submit" name="action" value="approve">승인</button></div>
</form>
<p class="muted">연결은 설정 &gt; AI 연결(MCP) 에서 언제든 해제할 수 있습니다.</p>`;
  return html(200, page("QuickNote 연결 승인", inner), csp(redirect.origin));
}
