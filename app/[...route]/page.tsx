import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readPluginRegistryWithSource } from "@/worker/plugin-registry";
import { PluginHub } from "../plugin-hub";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ route: string[] }> };

const pageDetails = {
  plugins: { page: "catalog" as const, title: "插件目录", description: "浏览、搜索和筛选 DeepSeek Harness 社区插件。" },
  rank: { page: "rank" as const, title: "排行榜", description: "按 GitHub 星标和最近更新时间查看 DSH 插件。" },
  submit: { page: "submit" as const, title: "提交收录", description: "检查并提交公开的 DSH 插件仓库。" },
  guide: { page: "guide" as const, title: "开发指南", description: "创建可检查、可验证的 DeepSeek Harness 插件。" },
};

async function registry() {
  return readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { route } = await params;
  if (route[0] === "plugin" && route.length === 3) {
    const { registry: data } = await registry();
    const id = `${route[1]}/${route[2]}`.toLowerCase();
    const plugin = data.plugins.find((item) => item.id === id);
    if (!plugin) return {};
    const canonical = `/plugin/${route[1]}/${route[2]}`;
    return {
      title: plugin.name,
      description: plugin.description.zh,
      alternates: { canonical },
      openGraph: { title: plugin.name, description: plugin.description.zh, url: canonical },
    };
  }
  const details = pageDetails[route[0] as keyof typeof pageDetails];
  if (!details || route.length !== 1) return {};
  return {
    title: details.title,
    description: details.description,
    alternates: { canonical: `/${route[0]}` },
  };
}

export default async function RoutedHub({ params }: Props) {
  const { route } = await params;
  const { registry: data, source } = await registry();
  if (route[0] === "plugin" && route.length === 3) {
    const id = `${route[1]}/${route[2]}`.toLowerCase();
    if (!data.plugins.some((plugin) => plugin.id === id)) notFound();
    return <PluginHub data={data} initialPage="catalog" initialPluginId={id} initialSource={source === "node-file" ? "live" : "bundled"} />;
  }
  const details = pageDetails[route[0] as keyof typeof pageDetails];
  if (!details || route.length !== 1) notFound();
  return <PluginHub data={data} initialPage={details.page} initialSource={source === "node-file" ? "live" : "bundled"} />;
}
