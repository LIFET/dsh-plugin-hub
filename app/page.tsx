import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { CategoryId, PluginRegistryData } from "@/lib/plugin-data";
import { readPluginRegistryWithSource } from "@/worker/plugin-registry";
import { jsonLdScript } from "./json-ld";
import { PluginHub } from "./plugin-hub";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh";
  return {
    title: { absolute: lang === "en" ? "DSH Plugin Hub" : "DSH 插件资源站" },
    description: lang === "en"
      ? "A DeepSeek Harness community plugin index with real GitHub data, manifest evidence, maintenance signals, and installation boundaries."
      : "DeepSeek Harness 社区插件目录：真实 GitHub 数据、manifest 证据、活跃度与安装边界。",
  };
}

export default async function Home() {
  const cookieStore = await cookies();
  const initialLanguage = cookieStore.get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh";
  const initialTheme = cookieStore.get("dsh-plugin-hub-theme")?.value === "dark" ? "dark" : "light";
  const { registry, source } = await readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
  const categoryCounts = Object.fromEntries(
    Object.keys(registry.categories).map((id) => [
      id,
      registry.plugins.filter((plugin) => plugin.category === id).length,
    ]),
  ) as Record<CategoryId, number>;
  const inspectedCount = registry.plugins.filter((plugin) => plugin.screening.scope === "source").length;
  const featured = [...registry.plugins]
    .filter((plugin) => plugin.stars !== null)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 6);
  const data: PluginRegistryData = { ...registry, plugins: featured };
  const siteName = initialLanguage === "en" ? "DSH Plugin Hub" : "DSH 插件资源站";
  return (
    <>
      {jsonLdScript({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteName,
        url: "https://apiu.cc/",
        inLanguage: initialLanguage === "en" ? "en" : "zh-CN",
        potentialAction: {
          "@type": "SearchAction",
          target: "https://apiu.cc/plugins?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      })}
      <PluginHub data={data} initialSource={source === "node-file" ? "live" : "bundled"} initialLanguage={initialLanguage} initialTheme={initialTheme} initialCategoryCounts={categoryCounts} initialInspectedCount={inspectedCount} />
    </>
  );
}
