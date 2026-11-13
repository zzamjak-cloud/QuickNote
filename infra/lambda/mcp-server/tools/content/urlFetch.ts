// 외부 이미지 URL 다운로드 — 서버측 요청 위조(SSRF) 방지: http(s)만, 비공인 주소(모든 IPv6 표기 포함) 거부,
// 실제 연결 시점의 DNS 조회 결과를 다시 검증해 그 IP 로만 연결(DNS 리바인딩 차단),
// 리다이렉트는 수동으로 따라가며 매 홉 재검사, 시간·크기 상한.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { ToolError } from "../../context";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const PUBLIC_ADDRESS_ERROR = "Image URL must point to a public internet address";

/** DNS 조회 함수(테스트에서 리바인딩 시나리오를 주입하기 위해 교체 가능). */
export type Resolver = (host: string) => Promise<LookupAddress[]>;

const defaultResolver: Resolver = (host) =>
  new Promise((resolve, reject) => {
    dnsLookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });

// 비공인 대역. IPv4-mapped/compatible·NAT64·6to4·Teredo 처럼 IPv4 를 품는 IPv6 대역은
// 표기(16진·점 10진)와 무관하게 대역 전체를 막는다 — Lambda 는 이런 경로로 공인 IPv4 에 갈 일이 없다.
// BlockList 는 IPv4 를 IPv4-mapped IPv6 로도 대조하므로(::ffff:0:0/96 규칙이 모든 IPv4 와 일치) 패밀리별로 분리한다.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");
}

/** 공인 주소가 아니면 true. IP 로 해석할 수 없는 문자열도 차단한다. */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(addr);
  if (family === 0) return true;
  return family === 4 ? BLOCKED_V4.check(addr, "ipv4") : BLOCKED_V6.check(addr, "ipv6");
}

async function resolvePublic(host: string, resolver: Resolver): Promise<LookupAddress[]> {
  const addresses = await resolver(host).catch(() => []);
  if (addresses.length === 0) throw new ToolError(`Could not resolve ${host}`);
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new ToolError(PUBLIC_ADDRESS_ERROR);
  return addresses;
}

/** 소켓 연결 직전에 호출되는 lookup — 여기서 검증한 주소로만 연결되므로 사전 검사 후 재조회(TOCTOU)가 무력화된다. */
export function createValidatingLookup(resolver: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublic(hostname, resolver).then(
      (addresses) => {
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => a.family === options.family) : addresses;
        const usable = wanted.length > 0 ? wanted : addresses;
        if (options.all) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, "", 0),
    );
  };
}

async function assertPublicUrl(raw: string, resolver: Resolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError("Invalid image URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ToolError("Image URL must be http(s)");
  if (url.username || url.password) throw new ToolError("Image URL must not contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ToolError(PUBLIC_ADDRESS_ERROR);
  } else {
    // 빠른 거부용 사전 검사. 실제 연결은 createValidatingLookup 이 다시 검증한다.
    await resolvePublic(host, resolver);
  }
  return url;
}

async function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    throw new ToolError(`Image is larger than ${maxBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      res.destroy();
      throw new ToolError(`Image is larger than ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function request(url: URL, lookup: LookupFunction, signal: AbortSignal): Promise<http.IncomingMessage> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: "GET", lookup, signal, agent: false }, resolve);
    req.on("error", (err) => reject(err instanceof ToolError ? err : new ToolError("Could not download the image URL")));
    req.end();
  });
}

export async function fetchPublicBytes(raw: string, maxBytes: number, resolver: Resolver = defaultResolver): Promise<Buffer> {
  const lookup = createValidatingLookup(resolver);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = await assertPublicUrl(raw, resolver);
  for (let hop = 0; ; hop += 1) {
    const res = await request(url, lookup, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = res.headers.location;
      res.resume();
      if (!location || hop >= MAX_REDIRECTS) throw new ToolError("Too many redirects while downloading the image");
      url = await assertPublicUrl(new URL(location, url).toString(), resolver);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new ToolError(`Image download failed with HTTP ${status}`);
    }
    return readCapped(res, maxBytes);
  }
}
