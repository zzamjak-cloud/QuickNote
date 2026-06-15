export type GraphqlArgs = {
  query: string;
  variables?: Record<string, unknown>;
  authMode?: "apiKey" | "iam" | "identityPool" | "oidc" | "userPool" | "lambda" | "none";
  authToken?: string;
};

export type GraphqlAdditionalHeaders =
  | Record<string, string>
  | (() => Promise<Record<string, string>> | Record<string, string>);

type GraphqlExecutor = (
  args: GraphqlArgs,
  additionalHeaders?: GraphqlAdditionalHeaders,
) => Promise<unknown> | unknown;

type GraphqlGuardOptions = {
  now?: () => number;
  windowMs?: number;
  maxCallsPerWindow?: number;
  blockMs?: number;
  onBlocked?: (key: string) => void;
};

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_MAX_CALLS_PER_WINDOW = 20;
const DEFAULT_BLOCK_MS = 60_000;

type Bucket = {
  startedAt: number;
  count: number;
  blockedUntil: number;
};

function operationType(query: string): "query" | "mutation" | "subscription" {
  const trimmed = query.trimStart();
  if (trimmed.startsWith("mutation")) return "mutation";
  if (trimmed.startsWith("subscription")) return "subscription";
  return "query";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function guardKey(args: GraphqlArgs): string {
  return JSON.stringify({
    query: args.query.replace(/\s+/g, " ").trim(),
    variables: stableValue(args.variables ?? {}),
  });
}

export function createGuardedGraphql(
  execute: GraphqlExecutor,
  options: GraphqlGuardOptions = {},
): GraphqlExecutor {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxCallsPerWindow = options.maxCallsPerWindow ?? DEFAULT_MAX_CALLS_PER_WINDOW;
  const blockMs = options.blockMs ?? DEFAULT_BLOCK_MS;
  const inFlightQueries = new Map<string, Promise<unknown>>();
  const buckets = new Map<string, Bucket>();

  return (args, additionalHeaders) => {
    const type = operationType(args.query);
    if (type === "subscription") return execute(args, additionalHeaders);

    const key = guardKey(args);
    const at = now();
    const prev = buckets.get(key);
    if (prev && prev.blockedUntil > at) {
      options.onBlocked?.(key);
      return Promise.reject(new Error("GraphQL circuit open: repeated operation blocked"));
    }

    const bucket =
      prev && at - prev.startedAt < windowMs
        ? prev
        : { startedAt: at, count: 0, blockedUntil: 0 };
    bucket.count += 1;
    if (bucket.count > maxCallsPerWindow) {
      bucket.blockedUntil = at + blockMs;
      buckets.set(key, bucket);
      options.onBlocked?.(key);
      return Promise.reject(new Error("GraphQL circuit open: repeated operation blocked"));
    }
    buckets.set(key, bucket);

    if (type === "query") {
      const current = inFlightQueries.get(key);
      if (current) return current;
      const pending = Promise.resolve(execute(args, additionalHeaders)).finally(() => {
        inFlightQueries.delete(key);
      });
      inFlightQueries.set(key, pending);
      return pending;
    }

    return execute(args, additionalHeaders);
  };
}
