import { readPluginRegistryWithSource } from "@/worker/plugin-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { registry, source } = await readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });

  return Response.json({
    generatedAt: registry.generatedAt,
    source,
    automation: registry.automation,
    summary: {
      listed: registry.summary.listed,
      autoDiscovered: registry.summary.autoDiscovered,
      screeningClear: registry.summary.screeningClear,
      screeningReview: registry.summary.screeningReview,
      screeningBlocked: registry.summary.screeningBlocked,
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
