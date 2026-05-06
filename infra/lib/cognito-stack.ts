import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";

export interface CognitoStackProps extends cdk.StackProps {
  cognitoDomainPrefix: string;
  webCallbackUrls: string[];
  webLogoutUrls: string[];
  desktopCallbackUrls: string[];
  desktopLogoutUrls: string[];
  googleSecretName: string;
}

export class CognitoStack extends cdk.Stack {
  // 다른 스택에서 cross-stack reference 로 참조하기 위한 공개 getter.
  public readonly userPoolId: string;
  public readonly userPoolArn: string;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    // Members 테이블 GSI(byEmail) 조회로 가입 허용 여부를 검증하는 Lambda.
    const preSignUpFn = new lambdaNode.NodejsFunction(this, "PreSignUpFn", {
      entry: path.join(__dirname, "..", "lambda", "pre-sign-up", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        MEMBERS_TABLE_NAME: "quicknote-members",
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });

    preSignUpFn.role!.attachInlinePolicy(
      new iam.Policy(this, "PreSignUpDdbPolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["dynamodb:Query"],
            resources: [
              `arn:aws:dynamodb:${this.region}:${this.account}:table/quicknote-members`,
              `arn:aws:dynamodb:${this.region}:${this.account}:table/quicknote-members/index/byEmail`,
            ],
          }),
        ],
      }),
    );

    // Cognito 가입 완료 후 cognitoSub 를 Members 테이블에 매핑하는 Lambda.
    const postConfirmationFn = new lambdaNode.NodejsFunction(this, "PostConfirmationFn", {
      entry: path.join(__dirname, "..", "lambda", "post-confirmation", "index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        MEMBERS_TABLE_NAME: "quicknote-members",
      },
      bundling: {
        minify: true,
        target: "node20",
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
      },
    });

    postConfirmationFn.role!.attachInlinePolicy(
      new iam.Policy(this, "PostConfirmationDdbPolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
            resources: [
              `arn:aws:dynamodb:${this.region}:${this.account}:table/quicknote-members`,
              `arn:aws:dynamodb:${this.region}:${this.account}:table/quicknote-members/index/byEmail`,
            ],
          }),
        ],
      }),
    );

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "quicknote-users",
      selfSignUpEnabled: true, // 페더레이션 진입을 위해 필요. PreSignUp Lambda로 차단.
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.NONE, // 비밀번호 가입 미사용
      removalPolicy: cdk.RemovalPolicy.RETAIN, // 사용자 데이터 보존
      lambdaTriggers: {
        preSignUp: preSignUpFn,
        postConfirmation: postConfirmationFn,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
    });

    // Google client id/secret 은 Secrets Manager 에서 주입.
    const googleSecret = secrets.Secret.fromSecretNameV2(
      this,
      "GoogleOAuthSecret",
      props.googleSecretName,
    );

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
      userPool,
      clientId: googleSecret.secretValueFromJson("clientId").unsafeUnwrap(),
      clientSecretValue: googleSecret.secretValueFromJson("clientSecret"),
      scopes: ["profile", "email", "openid"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    const supportedIdps = [cognito.UserPoolClientIdentityProvider.GOOGLE];

    const oAuthFlows: cognito.OAuthFlows = {
      authorizationCodeGrant: true,
      implicitCodeGrant: false,
      clientCredentials: false,
    };
    const oAuthScopes = [
      cognito.OAuthScope.OPENID,
      cognito.OAuthScope.EMAIL,
      cognito.OAuthScope.PROFILE,
    ];

    const webClient = userPool.addClient("WebClient", {
      userPoolClientName: "quicknote-web",
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: oAuthFlows,
        scopes: oAuthScopes,
        callbackUrls: props.webCallbackUrls,
        logoutUrls: props.webLogoutUrls,
      },
      supportedIdentityProviders: supportedIdps,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    webClient.node.addDependency(googleProvider);

    const desktopClient = userPool.addClient("DesktopClient", {
      userPoolClientName: "quicknote-desktop",
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: oAuthFlows,
        scopes: oAuthScopes,
        callbackUrls: props.desktopCallbackUrls,
        logoutUrls: props.desktopLogoutUrls,
      },
      supportedIdentityProviders: supportedIdps,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    desktopClient.node.addDependency(googleProvider);

    const domain = userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix: props.cognitoDomainPrefix },
    });

    new cdk.CfnOutput(this, "Region", { value: this.region });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "WebClientId", { value: webClient.userPoolClientId });
    new cdk.CfnOutput(this, "DesktopClientId", { value: desktopClient.userPoolClientId });
    new cdk.CfnOutput(this, "HostedUiDomain", {
      value: `${domain.domainName}.auth.${this.region}.amazoncognito.com`,
    });

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
  }
}
