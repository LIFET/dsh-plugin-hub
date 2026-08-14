import { preflightPluginRepository } from "@/worker/plugin-registry";
import { createPreflightLimiter } from "@/lib/preflight-limiter.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const limiter = createPreflightLimiter();
const MAX_BODY_BYTES = 2_000;

function clientIdentifier(request: Request) {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
    || "unknown";
}

async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("request body too large");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export async function POST(request: Request) {
  if (!limiter.allowClient(clientIdentifier(request))) return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "请求内容过大" }, { status: 413 });
  }
  try {
    const body = JSON.parse(await readBody(request)) as { url?: unknown };
    if (typeof body.url !== "string" || body.url.length > 300) {
      return Response.json({ error: "请输入有效的仓库地址" }, { status: 400 });
    }
    const key = body.url.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return Response.json(hit.value);
    if (!limiter.reserveGithub(Boolean(process.env.GITHUB_TOKEN?.trim()))) {
      return Response.json({ error: "GitHub 匿名检查额度已用完，请稍后再试" }, { status: 429 });
    }
    const result = await preflightPluginRepository(body.url, {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
    });
    cache.set(key, { expiresAt: Date.now() + 10 * 60_000, value: result });
    if (cache.size > 200) cache.delete(cache.keys().next().value || "");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json({ error: "请求内容过大" }, { status: 413 });
    }
    const message = error instanceof Error ? error.message : "仓库检查失败";
    const status = /请输入|只支持|仓库地址/u.test(message) ? 400 : 502;
    return Response.json({ error: status === 400 ? message : "暂时无法读取该仓库，请稍后重试" }, { status });
  }
}
