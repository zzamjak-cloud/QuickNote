# QuickNote 인프라 (v3.0.0)

AWS Cognito + Google OAuth + 화이트리스트 Lambda 를 CDK(TypeScript)로 정의한다.

## 사전 준비

1. AWS CLI 설정 (`aws configure`).
2. Node.js 20+, npm.
3. CDK 부트스트랩이 안 된 계정/리전이면:
   ```bash
   npx cdk bootstrap aws://<account>/<region>
   ```
4. Google Cloud Console 에서 **OAuth 2.0 Client ID** 발급.
   - 애플리케이션 유형: 웹 애플리케이션
   - 승인된 리디렉션 URI: `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
   - 발급된 client id / secret 을 Secrets Manager 에 등록:
     ```bash
     aws secretsmanager create-secret \
       --name quicknote/google-oauth \
       --secret-string '{"clientId":"...","clientSecret":"..."}'
     ```

## 배포

```bash
cd infra
npm install
npm run diff -- -c allowedEmails=jinpyoung@loadcomplete.com
npm run deploy -- -c allowedEmails=jinpyoung@loadcomplete.com
```

배포 후 `cdk-outputs.json` 이 생성된다. 아래 값을 프론트엔드 `.env` 에 옮긴다.

| Output | 매핑할 env |
|---|---|
| `Region` | `VITE_COGNITO_REGION` |
| `UserPoolId` | `VITE_COGNITO_USER_POOL_ID` |
| `WebClientId` | `VITE_COGNITO_WEB_CLIENT_ID` |
| `DesktopClientId` | `VITE_COGNITO_DESKTOP_CLIENT_ID` |
| `HostedUiDomain` | `VITE_COGNITO_HOSTED_UI_DOMAIN` |

## 화이트리스트 갱신

`-c allowedEmails=...` 값을 바꿔 다시 `npm run deploy` 하면 Lambda 환경변수만 갱신된다.

이미 가입된 사용자가 있는데 화이트리스트에서 제거하려면 별도로 삭제해야 한다:

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id <UserPoolId> \
  --username <email>
```

## 테스트

```bash
npm test
```

PreSignUp Lambda 에 대한 단위 테스트만 포함되어 있다 (CDK 합성 테스트는 v4 에서 추가 예정).

## 정리

```bash
npm run destroy -- -c allowedEmails=dummy@x.com
```

User Pool 은 `removalPolicy: RETAIN` 이므로 콘솔에서 수동 삭제해야 완전히 제거된다.
