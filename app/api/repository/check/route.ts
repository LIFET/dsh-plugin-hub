import { preflightPluginRepository } from "@/worker/plugin-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, { expiresAt: number; value: unknown }>();
const clients = new Map<string, { startedAt: number; count: number }>();
let anonymousGithubBudget = { startedAt: 0, count: 0 };

function allow(request: Request) {
  const now = Date.now();
  if (!process.env.GITHUB_TOKEN?.trim()) {
    if (now - anonymousGithubBudget.startedAt >= 60 * 60_000) anonymousGithubBudget = { startedAt: now, count: 0 };
    anonymousGithubBudget.count += 1;
    if (anonymousGithubBudget.count > 10) return false;
  }
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const current = clients.get(client);
  if (!current || now - current.startedAt >= 60_000) {
    clients.set(client, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 8;
}

export async function POST(request: Request) {
  if (!allow(request)) return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  if (Number(request.headers.get("content-length") || 0) > 2_000) {
    return Response.json({ error: "请求内容过大" }, { status: 413 });
  }
  try {
    const body = await request.json() as { url?: unknown };
    if (typeof body.url !== "string" || body.url.length > 300) {
      return Response.json({ error: "请输入有效的仓库地址" }, { status: 400 });
    }
    const key = body.url.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return Response.json(hit.value);
    const result = await preflightPluginRepository(body.url, {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
    });
    cache.set(key, { expiresAt: Date.now() + 10 * 60_000, value: result });
    if (cache.size > 200) cache.delete(cache.keys().next().value || "");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "仓库检查失败";
    const status = /请输入|只支持|仓库地址/u.test(message) ? 400 : 502;
    return Response.json({ error: status === 400 ? message : "暂时无法读取该仓库，请稍后重试" }, { status });
  }
}
