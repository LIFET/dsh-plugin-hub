import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC, Source_Sans_3 } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source",
  display: "swap",
});

const notoSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto",
  display: "swap",
});

const preferenceBootstrap = `try{const p=JSON.parse(localStorage.getItem('dsh-plugin-hub-prefs-v2')||'{}');if(p.theme==='dark'||p.theme==='light'){document.documentElement.dataset.theme=p.theme;document.documentElement.style.colorScheme=p.theme}if(p.lang==='en')document.documentElement.lang='en'}catch{}`;

const sharedMetadata: Metadata = {
    metadataBase: new URL("https://apiu.cc"),
    alternates: { canonical: "/" },
    keywords: ["DeepSeek Harness", "DSH", "dsh-plugin", "插件目录", "AI Agent"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
      shortcut: "/favicon.svg",
    },
    manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#101412" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh";
  const english = lang === "en";
  const siteName = english ? "DSH Plugin Hub" : "DSH 插件资源站";
  const description = english
    ? "A DeepSeek Harness community plugin index built on real GitHub data and installation evidence."
    : "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。";
  return {
    ...sharedMetadata,
    title: { default: siteName, template: `%s · ${siteName}` },
    description,
    openGraph: {
      type: "website",
      locale: english ? "en_US" : "zh_CN",
      alternateLocale: english ? "zh_CN" : "en_US",
      siteName,
      title: siteName,
      description: english ? "Check source, manifest, and maintenance evidence before installing." : "先看来源、清单和维护信号，再决定装不装。",
      images: [{ url: "/og.jpg", width: 1200, height: 630, alt: siteName }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description: english ? "Real GitHub data, manifest evidence, and installation boundaries." : "真实 GitHub 数据、manifest 证据与安装边界。",
      images: ["/og.jpg"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLanguage = cookieStore.get("dsh-plugin-hub-lang")?.value === "en" ? "en" : "zh-CN";
  const initialTheme = cookieStore.get("dsh-plugin-hub-theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang={initialLanguage} data-theme={initialTheme} className={`${sourceSans.variable} ${notoSans.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} /></head>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: `<!-- THESIS: A working catalog. Search, then names, then evidence, then a pinned command. Not a color costume. OWN-WORLD: Cool paper, white list panel, one teal for action and current, one sans. STORY: Find a plugin, read the check, copy the command. FIRST VIEWPORT: Light header. One-line job. Search. The list starts in the same view. Catalog: filters left, results right. FORM: Product tool, not a theme. No footer author. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->` }} />
        {children}
      </body>
    </html>
  );
}
