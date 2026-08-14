import {
  pluginRegistryResponse,
  readPluginRegistryWithSource,
} from "@/worker/plugin-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { registry, source } = await readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
  const etag = `W/"${registry.generatedAt}-${registry.summary.listed}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const response = pluginRegistryResponse(registry, source);
  response.headers.set("ETag", etag);
  return response;
}
