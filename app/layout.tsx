import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://dsh.lanshuagent.com"),
    title: {
      default: "DSH 插件资源站",
      template: "%s · DSH 插件资源站",
    },
    description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
