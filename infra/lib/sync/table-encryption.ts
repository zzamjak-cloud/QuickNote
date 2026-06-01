import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

// DynamoDB 기본 AWS-owned key 암호화. AWS KMS 요청 비용이 붙는 AWS_MANAGED 를 쓰지 않는다.
export const DYNAMODB_TABLE_ENCRYPTION = dynamodb.TableEncryption.DEFAULT;
