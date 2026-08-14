import type { Metadata } from "next";
import { readPluginRegistryWithSource } from "@/worker/plugin-registry";
import { PluginHub } from "./plugin-hub";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "DSH 插件资源站" },
  description: "DeepSeek Harness 社区插件目录：真实 GitHub 数据、manifest 证据、活跃度与安装边界。",
};

export default async function Home() {
  const { registry, source } = await readPluginRegistryWithSource({
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    REGISTRY_DATA_DIR: process.env.REGISTRY_DATA_DIR,
  });
  return <PluginHub data={registry} initialSource={source === "node-file" ? "live" : "bundled"} />;
}
