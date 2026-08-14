import { timingSafeEqual } from "node:crypto";
import {
  RegistrySyncInProgressError,
  syncPluginRegistry,
} from "@/worker/plugin-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !provided) return false;
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const requestedLimit = request.headers.get("x-registry-scan-limit") || undefined;
    const registry = await syncPluginRegistry({
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
      REGISTRY_SCAN_LIMIT: requestedLimit,
    });
    return Response.json({
      status: registry.automation.state,
      generatedAt: registry.generatedAt,
      checked: registry.automation.checkedThisRun,
      admitted: registry.automation.admittedThisRun,
      listed: registry.summary.listed,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RegistrySyncInProgressError) {
      return Response.json({ status: "busy" }, { status: 409 });
    }
    console.error(JSON.stringify({
      event: "registry.sync.route.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "sync_failed" }, { status: 500 });
  }
}
