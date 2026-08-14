import type { Metadata } from "next";
import { pluginRegistry } from "@/lib/plugin-data";
import { PluginHub } from "./plugin-hub";

export const metadata: Metadata = {
  title: { absolute: "DSH 插件资源站" },
  description: "DeepSeek Harness 社区插件目录：真实 GitHub 数据、manifest 证据、活跃度与安装边界。",
};

export default function Home() {
  return <PluginHub data={pluginRegistry} />;
}
