import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from "aws-lambda";

// ALLOWED_EMAILS 는 콤마로 구분된 소문자 이메일 목록.
function parseAllowList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowed(email: string | undefined, list: Set<string>): boolean {
  if (!email) return false;
  return list.has(email.trim().toLowerCase());
}

export const handler: PreSignUpTriggerHandler = async (event: PreSignUpTriggerEvent) => {
  const allowed = parseAllowList(process.env.ALLOWED_EMAILS);
  const email = event.request.userAttributes?.email;

  if (!isAllowed(email, allowed)) {
    // throw 하면 Cognito 가입을 거부하고, Hosted UI 에 에러를 노출한다.
    throw new Error("UNAUTHORIZED_EMAIL");
  }

  // 외부 IdP(Google) 페더레이션 흐름이면 이메일 자동 검증 + 자동 확인.
  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    event.response.autoVerifyEmail = true;
    event.response.autoConfirmUser = true;
  } else {
    // 비밀번호 가입은 운영상 사용하지 않지만 안전한 기본값.
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  return event;
};
