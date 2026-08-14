import type { MetadataRoute } from "next";
import { readPluginRegistryWithSource } from "@/worker/plugin-registry";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { registry } = await readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
  const base = "https://apiu.cc";
  const generated = new Date(registry.generatedAt);
  return [
    { url: base, lastModified: generated, changeFrequency: "daily", priority: 1 },
    { url: `${base}/plugins`, lastModified: generated, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/rank`, lastModified: generated, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/submit`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/guide`, changeFrequency: "monthly", priority: 0.6 },
    ...registry.plugins.map((plugin) => ({
      url: `${base}/plugin/${plugin.id.split("/").map(encodeURIComponent).join("/")}`,
      lastModified: plugin.updatedAt ? new Date(plugin.updatedAt) : generated,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
