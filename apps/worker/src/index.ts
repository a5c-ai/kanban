import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { initRepo, loadOps, subscribeOps, type AnyOp } from "@a5c-ai/kanban-sdk";

type SecretRef = { secretRef: string };
type HeaderValue = string | SecretRef;

interface WebhookSubscription {
  id?: string;
  url: string;
  events?: string[];
  headers?: Record<string, HeaderValue>;
  maxAttempts?: number;
  timeoutMs?: number;
}

interface WebhooksConfigFile {
  schemaVersion: 1;
  webhooks: WebhookSubscription[];
}

function parseArgs(argv: string[]): { repoPath: string } {
  const repoFlagIdx = argv.indexOf("--repo");
  if (repoFlagIdx !== -1 && argv[repoFlagIdx + 1]) {
    return { repoPath: path.resolve(argv[repoFlagIdx + 1]) };
  }

  const repoEquals = argv.find((a) => a.startsWith("--repo="));
  if (repoEquals) {
    const value = repoEquals.slice("--repo=".length);
    if (value) return { repoPath: path.resolve(value) };
  }

  const positional = argv.find((a) => !a.startsWith("-"));
  if (positional) return { repoPath: path.resolve(positional) };

  throw new Error("Usage: npm run worker -- --repo <path>");
}

function isSecretRef(value: unknown): value is SecretRef {
  return (
    !!value &&
    typeof value === "object" &&
    "secretRef" in value &&
    typeof (value as { secretRef?: unknown }).secretRef === "string"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadWebhooks(repoPath: string): Promise<WebhookSubscription[]> {
  const configPath = path.join(repoPath, ".kanban", "integrations", "webhooks.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as WebhooksConfigFile;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.webhooks)) return [];
    return parsed.webhooks.filter(
      (w): w is WebhookSubscription => !!w && typeof w === "object" && typeof w.url === "string",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    process.stderr.write(`worker: failed to load webhooks.json: ${(error as Error).message}\n`);
    return [];
  }
}

function resolveHeaders(headers: Record<string, HeaderValue> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") {
      out[k] = v;
      continue;
    }
    if (isSecretRef(v)) {
      const envValue = process.env[v.secretRef];
      if (envValue) out[k] = envValue;
      else process.stderr.write(`worker: missing env var for secretRef: ${v.secretRef}\n`);
    }
  }
  return out;
}

function shouldDeliver(hook: WebhookSubscription, op: AnyOp): boolean {
  if (!hook.events || hook.events.length === 0) return true;
  return hook.events.includes(op.type);
}

function requestJson(args: {
  url: URL;
  body: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(args.body);
    const req = https.request(
      {
        protocol: args.url.protocol,
        hostname: args.url.hostname,
        port: args.url.port ? Number(args.url.port) : undefined,
        path: `${args.url.pathname}${args.url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload).toString(),
          ...args.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(args.timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${args.timeoutMs}ms`));
    });
    req.write(payload);
    req.end();
  });
}

async function deliverWithRetries(args: {
  hookId: string;
  hook: WebhookSubscription;
  op: AnyOp;
}): Promise<void> {
  const url = new URL(args.hook.url);
  if (url.protocol !== "https:") {
    process.stderr.write(
      `worker: refusing non-https webhook url hookId=${args.hookId} url=${args.hook.url}\n`,
    );
    return;
  }

  const timeoutMs = args.hook.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, args.hook.maxAttempts ?? 5);

  const webhookId = `${args.hookId}:${args.op.opId}`;
  const headers = {
    "User-Agent": "@trello-clone/worker/0.1.0",
    "X-Webhook-Id": webhookId,
    ...resolveHeaders(args.hook.headers),
  };

  const body: unknown = {
    schemaVersion: 1,
    eventId: args.op.opId,
    eventType: args.op.type,
    ts: args.op.ts,
    actorId: args.op.actorId,
    payload: args.op.payload,
    op: args.op,
  };

  let attempt = 0;
  let delayMs = 200;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const res = await requestJson({ url, body, headers, timeoutMs });
      const retryable = res.statusCode === 429 || res.statusCode >= 500 || res.statusCode === 0;
      if (res.statusCode >= 200 && res.statusCode < 300) return;
      if (!retryable || attempt >= maxAttempts) {
        process.stderr.write(
          `worker: webhook failed hookId=${args.hookId} opId=${args.op.opId} status=${res.statusCode} body=${res.body}\n`,
        );
        return;
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        process.stderr.write(
          `worker: webhook error hookId=${args.hookId} opId=${args.op.opId} err=${(error as Error).message}\n`,
        );
        return;
      }
    }

    const jitter = Math.floor(Math.random() * 50);
    await sleep(delayMs + jitter);
    delayMs *= 2;
  }
}

async function main(): Promise<void> {
  const { repoPath } = parseArgs(process.argv.slice(2));
  await initRepo({ path: repoPath });

  const existing = await loadOps(repoPath);
  const afterSeq = existing.reduce((max, op) => (op.seq > max ? op.seq : max), 0);

  process.stdout.write(`worker: watching ops repo=${repoPath} afterSeq=${afterSeq}\n`);

  await subscribeOps({
    repoPath,
    afterSeq,
    onOps: (ops) => {
      (async () => {
        const hooks = await loadWebhooks(repoPath);
        if (hooks.length === 0) return;

        for (const op of ops) {
          for (let i = 0; i < hooks.length; i += 1) {
            const hook = hooks[i];
            const hookId = hook.id ?? `hook-${i + 1}`;
            if (!shouldDeliver(hook, op)) continue;
            await deliverWithRetries({ hookId, hook, op });
          }
        }
      })().catch((err) => {
        process.stderr.write(`worker: unexpected error: ${(err as Error).message}\n`);
      });
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
