// AppSync IAM(SigV4) 호출 — Lambda 실행 역할 자격증명으로 @aws_iam mutation(publish*Changed)을 호출한다.
// template-automation runner 와 MCP 서버가 공유한다. 서명은 외부 SDK 없이 직접 계산한다.
import { createHash, createHmac } from "node:crypto";
import { requireEnv } from "./env";

function amzDateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function hashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "appsync");
  return hmac(kService, "aws4_request");
}

export function signedAppSyncHeaders(args: {
  endpoint: string;
  body: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Record<string, string> {
  const env = args.env ?? process.env;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = env.AWS_SESSION_TOKEN;
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "ap-northeast-2";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are required to publish AppSync page change");
  }
  const url = new URL(args.endpoint);
  const { amzDate, dateStamp } = amzDateParts(args.now);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: url.host,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}`)
    .join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "POST",
    url.pathname || "/graphql",
    "",
    canonicalHeaders,
    signedHeaders,
    hashHex(args.body),
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/appsync/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(secretAccessKey, dateStamp, region))
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** APPSYNC_GRAPHQL_URL 로 IAM 서명 POST. HTTP 오류·GraphQL errors 는 throw. */
export async function postAppSyncIam(query: string, variables: Record<string, unknown>): Promise<void> {
  const endpoint = requireEnv("APPSYNC_GRAPHQL_URL");
  const body = JSON.stringify({ query, variables });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: signedAppSyncHeaders({ endpoint, body }),
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AppSync HTTP ${response.status}: ${text}`);
  }
  const parsed = text ? JSON.parse(text) as { errors?: Array<{ message?: string }> } : {};
  if (parsed.errors?.length) {
    throw new Error(`AppSync mutation failed: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
}
