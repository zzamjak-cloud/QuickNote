# QuickNote 인프라

CDK(TypeScript) 로 정의한 두 개의 스택:

- **`QuicknoteCognitoStack`** (v3.0.0+) — AWS Cognito + Google OAuth + 화이트리스트 Lambda
- **`QuicknoteSyncStack`** (v4.0.0+) — AppSync GraphQL API + DynamoDB(4 테이블) + S3 + Lambda(이미지 PreSign · 야간 GC) + EventBridge cron

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

## v4 동기화 스택 배포 (`QuicknoteSyncStack`)

### 1. 리졸버 번들 빌드

AppSync JS 리졸버는 esbuild 로 사전 번들이 필요하다.

```bash
cd infra
npm install
npm run build:resolvers
```

산출물: `lib/sync/resolvers/dist/{upsert,softDelete,list,subscribe}.js`.

esbuild 출력 크기(예시):
- `list.js` 약 1.1kb
- `softDelete.js` 약 1.1kb
- `upsert.js` 약 1.0kb
- `subscribe.js` 약 0.5kb

### 2. 컨텍스트 변수 (선택)

이미지 버킷 이름은 기본적으로 `quicknote-images-{account}-{region}` 으로 구성된다.
다른 이름을 쓰려면 `imagesBucketName` 컨텍스트로 전달:

```bash
npx cdk deploy QuicknoteSyncStack -c imagesBucketName=my-bucket
```

### 3. 배포

```bash
npx cdk deploy QuicknoteSyncStack --outputs-file cdk-outputs.json
```

### 3-1. v5 마이그레이션 실행 (1회)

`QuicknoteSyncStack` 출력값에 `V5MigrationFunctionName` 이 포함된다.

```bash
aws lambda invoke \
  --function-name <V5MigrationFunctionName> \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  migration-result.json
```

`migration-result.json`에는 `owners`, `migratedPages`, `migratedDatabases` 카운트가 기록된다.

### 4. 출력값을 `.env` 에 매핑

| Output | 매핑할 env |
|---|---|
| `AppSyncEndpoint` | `VITE_APPSYNC_ENDPOINT` |
| `ImagesBucketName` | `VITE_S3_BUCKET_NAME` |
| `Region` (Cognito 스택과 동일) | `VITE_S3_REGION` |

`AppSyncRealtimeEndpoint` 는 별도 출력하지 않는다 — Amplify GraphQL 클라이언트가
endpoint 의 `appsync-api` → `appsync-realtime-api` 변환을 자동 처리한다.

### 비용 추정 (100 활성 사용자/월)

AppSync 요청 ~$15 + DDB on-demand ~$5 + S3 ~$3 + Lambda ~$1 = **약 $25/월**.

## 정리

```bash
npm run destroy -- -c allowedEmails=dummy@x.com
```

User Pool / DDB 테이블 / S3 버킷은 모두 `removalPolicy: RETAIN` 이므로 콘솔에서 수동 삭제해야 완전히 제거된다.
