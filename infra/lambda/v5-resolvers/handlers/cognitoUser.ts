import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

/**
 * sub 로 Cognito 사용자를 찾아 삭제한다. 없으면 아무것도 하지 않는다(멱등).
 * 멤버 영구 삭제 후 같은 이메일로 재등록할 때, 남은 Cognito 사용자가 PostConfirmation 을
 * 다시 타지 않아 새 Member 에 cognitoSub 가 연결되지 않는 문제를 막는다.
 */
export async function deleteCognitoUserBySub(userPoolId: string, sub: string): Promise<void> {
  const found = await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `sub = "${sub.replace(/"/g, "")}"`,
      Limit: 1,
    }),
  );
  const username = found.Users?.[0]?.Username;
  if (!username) return;
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
}
