import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface SyncStackProps extends cdk.StackProps {
  // CognitoStack 의 출력값을 cross-stack reference 로 받는다.
  userPoolId: string;
  userPoolArn: string;
  imagesBucketName: string;
}

export class QuicknoteSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SyncStackProps) {
    super(scope, id, props);

    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      "ImportedUserPool",
      props.userPoolArn,
    );

    // 자원은 후속 Task 들에서 추가된다.
    void userPool;
  }
}
