import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { describe, expect, it } from "vitest";
import { DYNAMODB_TABLE_ENCRYPTION } from "./table-encryption";

describe("DYNAMODB_TABLE_ENCRYPTION", () => {
  it("KMS 요청 비용이 붙지 않는 AWS-owned 기본 암호화를 사용한다", () => {
    expect(DYNAMODB_TABLE_ENCRYPTION).toBe(dynamodb.TableEncryption.DEFAULT);
  });
});
