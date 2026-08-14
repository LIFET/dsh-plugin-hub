import type { Metadata } from "next";
import "./globals.css";

const preferenceBootstrap = `try{const p=JSON.parse(localStorage.getItem('dsh-plugin-hub-prefs-v2')||'{}');if(p.theme==='dark'||p.theme==='light'){document.documentElement.dataset.theme=p.theme;document.documentElement.style.colorScheme=p.theme}if(p.lang==='en')document.documentElement.lang='en'}catch{}`;

export const metadata: Metadata = {
    metadataBase: new URL("https://apiu.cc"),
    title: {
      default: "DSH 插件资源站",
      template: "%s · DSH 插件资源站",
    },
    description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
    alternates: { canonical: "/" },
    keywords: ["DeepSeek Harness", "DSH", "dsh-plugin", "插件目录", "AI Agent"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      alternateLocale: "en_US",
      siteName: "DSH 插件资源站",
      title: "DSH 插件资源站",
      description: "先看来源、清单和维护信号，再决定装不装。",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "DSH 插件资源站" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DSH 插件资源站",
      description: "真实 GitHub 数据、manifest 证据与安装边界。",
      images: ["/og.png"],
    },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} /></head>
      <body>{children}</body>
    </html>
  );
}
