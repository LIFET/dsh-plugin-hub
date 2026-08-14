import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { PluginRegistryData } from "@/lib/plugin-data";
import { readPluginRegistryWithSource } from "@/worker/plugin-registry";
import { PluginHub } from "../plugin-hub";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ route: string[] }> };

const pageDetails = {
  plugins: { page: "catalog" as const, zh: ["插件目录", "浏览、搜索和筛选 DeepSeek Harness 社区插件。"], en: ["Plugin catalog", "Browse, search, and filter DeepSeek Harness community plugins."] },
  rank: { page: "rank" as const, zh: ["排行榜", "按 GitHub 星标和最近更新时间查看 DSH 插件。"], en: ["Leaderboard", "Explore DSH plugins by GitHub stars and recent activity."] },
  submit: { page: "submit" as const, zh: ["提交收录", "检查并提交公开的 DSH 插件仓库。"], en: ["Submit a plugin", "Check and submit a public DSH plugin repository."] },
  guide: { page: "guide" as const, zh: ["开发指南", "创建可检查、可验证的 DeepSeek Harness 插件。"], en: ["Development guide", "Build an inspectable and verifiable DeepSeek Harness plugin."] },
};

const registry = cache(async () => {
  return readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
});

function rankingData(data: PluginRegistryData) {
  const byStars = [...data.plugins]
    .filter((plugin) => plugin.stars !== null)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 20);
  const byFreshness = [...data.plugins]
    .filter((plugin) => plugin.pushedAt)
    .sort((a, b) => Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0"))
    .slice(0, 20);
  const plugins = [...new Map([...byStars, ...byFreshness].map((plugin) => [plugin.id, plugin])).values()];
  return { ...data, plugins };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { route } = await params;
  const lang = (await cookies()).get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh";
  if (route[0] === "plugin" && route.length === 3) {
    const { registry: data } = await registry();
    const id = `${route[1]}/${route[2]}`.toLowerCase();
    const plugin = data.plugins.find((item) => item.id === id);
    if (!plugin) return {};
    const canonical = `/plugin/${route[1]}/${route[2]}`;
    return {
      title: plugin.name,
      description: plugin.description[lang],
      alternates: { canonical },
      openGraph: { title: plugin.name, description: plugin.description[lang], url: canonical },
    };
  }
  const details = pageDetails[route[0] as keyof typeof pageDetails];
  if (!details || route.length !== 1) return {};
  const [title, description] = details[lang];
  return {
    title,
    description,
    alternates: { canonical: `/${route[0]}` },
  };
}

export default async function RoutedHub({ params }: Props) {
  const { route } = await params;
  const cookieStore = await cookies();
  const initialLanguage = cookieStore.get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh";
  const initialTheme = cookieStore.get("dsh-plugin-hub-theme")?.value === "dark" ? "dark" : "light";
  const { registry: data, source } = await registry();
  if (route[0] === "plugin" && route.length === 3) {
    const id = `${route[1]}/${route[2]}`.toLowerCase();
    if (!data.plugins.some((plugin) => plugin.id === id)) notFound();
    return <PluginHub data={data} initialPage="catalog" initialPluginId={id} initialSource={source === "node-file" ? "live" : "bundled"} initialLanguage={initialLanguage} initialTheme={initialTheme} />;
  }
  const details = pageDetails[route[0] as keyof typeof pageDetails];
  if (!details || route.length !== 1) notFound();
  const projected = details.page === "catalog"
    ? data
    : details.page === "rank"
      ? rankingData(data)
      : { ...data, plugins: [] };
  return <PluginHub data={projected} initialPage={details.page} initialSource={source === "node-file" ? "live" : "bundled"} initialLanguage={initialLanguage} initialTheme={initialTheme} />;
}
