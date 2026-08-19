"use client";

import type {
  CategoryId,
  Language,
  PluginRecord,
  PluginRegistryData,
} from "@/lib/plugin-data";
import { catalogPageTitle, comparePluginsByEvidence, displayDescription, displayInstallCommand, matchesSearchQuery, normalizeOwnerParam, pluginSearchHaystack, selectRelatedPlugins, suggestedInstallCommand, visiblePluginName, withPackageRunner } from "@/lib/plugin-screening.mjs";
import Link from "next/link";
import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type PageId = "home" | "catalog" | "rank" | "submit" | "guide" | "plugin";
type SortId = "evidence" | "curated" | "stars" | "updated" | "added" | "name";
type EvidenceFilter = "all" | "auto" | "topic" | "manifest" | "clear" | "installable" | "review" | "favorites";
const EVIDENCE_FILTERS: EvidenceFilter[] = ["all", "auto", "topic", "manifest", "clear", "installable", "review", "favorites"];

const PAGES: Array<{ id: Exclude<PageId, "plugin">; zh: string; en: string }> = [
  { id: "home", zh: "首页", en: "Home" },
  { id: "catalog", zh: "目录", en: "Catalog" },
  { id: "rank", zh: "排行榜", en: "Rank" },
  { id: "submit", zh: "收录", en: "Submit" },
  { id: "guide", zh: "指南", en: "Guide" },
];

const CATEGORY_ORDER: CategoryId[] = [
  "ui",
  "theme",
  "session",
  "memory",
  "tools",
  "workflow",
  "notify",
  "model",
  "dev",
  "fun",
];

const CATEGORY_HINTS: Record<CategoryId, Record<Language, string>> = {
  ui: { zh: "侧栏、面板、交互体验", en: "Panels, navigation, interaction" },
  theme: { zh: "皮肤、配色、外观", en: "Skins, colors, appearance" },
  session: { zh: "记忆、回退、分享、导入", en: "Memory, rewind, sharing, import" },
  memory: { zh: "长期记忆、知识库", en: "Long-term memory, knowledge" },
  tools: { zh: "视觉、文档、数据库、工具箱", en: "Vision, docs, databases, toolkits" },
  workflow: { zh: "多代理、定时任务、监视", en: "Multi-agent, schedules, watches" },
  notify: { zh: "桌面通知、IM、编辑器桥接", en: "Desktop, IM, editor bridges" },
  model: { zh: "模型、账号、供应商", en: "Models, accounts, providers" },
  dev: { zh: "沙箱、模型、运行时、体检", en: "Sandbox, models, runtime, audits" },
  fun: { zh: "桌宠、小游戏、贴纸", en: "Pets, minigames, stickers" },
};

const PREFS_KEY = "dsh-plugin-hub-prefs-v2";
const CATALOG_RETURN_KEY = "dsh-plugin-hub-catalog-return";
const RECENT_KEY = "dsh-plugin-hub-recent-v1";
const RESULT_BATCH_SIZE = 36;
const PAGE_PATHS: Record<Exclude<PageId, "plugin">, string> = {
  home: "/",
  catalog: "/plugins",
  rank: "/rank",
  submit: "/submit",
  guide: "/guide",
};

function catalogHrefFor(filters: {
  query?: string;
  owner?: string;
  category?: "all" | CategoryId;
  sort?: SortId;
  evidence?: EvidenceFilter;
}) {
  const params = new URLSearchParams();
  if (filters.query?.trim()) params.set("q", filters.query.trim());
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.sort && filters.sort !== "evidence") params.set("sort", filters.sort);
  if (filters.evidence && filters.evidence !== "all") params.set("evidence", filters.evidence);
  const search = params.toString();
  return `${PAGE_PATHS.catalog}${search ? `?${search}` : ""}`;
}

function text(lang: Language, zh: string, en: string) {
  return lang === "zh" ? zh : en;
}

function formatNumber(value: number | null, lang: Language) {
  if (value === null) return "—";
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function dayDistance(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function relativeDate(value: string | null, lang: Language) {
  const days = dayDistance(value);
  if (days === null) return "—";
  if (days === 0) return text(lang, "今天", "today");
  if (days < 30) return text(lang, `${days} 天前`, `${days}d ago`);
  if (days < 365) return text(lang, `${Math.floor(days / 30)} 个月前`, `${Math.floor(days / 30)}mo ago`);
  return text(lang, `${Math.floor(days / 365)} 年前`, `${Math.floor(days / 365)}y ago`);
}

function pageFromLocation(): PageId {
  if (typeof window === "undefined") return "home";
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  if (first === "plugins") return "catalog";
  if (first === "plugin") return "plugin";
  return PAGES.some((page) => page.id === first) ? (first as PageId) : "home";
}



function pluginPath(plugin: PluginRecord) {
  return `/plugin/${plugin.id.split("/").map(encodeURIComponent).join("/")}`;
}

function preferDedicatedPluginPage() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches;
}

function openInDrawer(event: MouseEvent<HTMLAnchorElement>, onOpen: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (preferDedicatedPluginPage()) return;
  event.preventDefault();
  onOpen();
}

function maintenanceLabel(plugin: PluginRecord, lang: Language) {
  const labels = {
    active: text(lang, "近 30 天活跃", "Active in 30d"),
    warm: text(lang, "近半年更新", "Updated in 6mo"),
    quiet: text(lang, "更新较少", "Quiet"),
    archived: text(lang, "已归档", "Archived"),
    unknown: text(lang, "活跃度未知", "Activity unknown"),
  };
  return labels[plugin.maintenance];
}

function signalLabel(plugin: PluginRecord, lang: Language) {
  if (plugin.screening.state === "blocked") return text(lang, "静态检查拦截", "Static scan blocked");
  if (plugin.screening.state === "review") return text(lang, "待人工复核", "Manual review");
  if (plugin.screening.state === "pending") return text(lang, "等待源码补扫", "Source scan pending");
  return text(lang, "静态检查通过", "Static scan clear");
}

function sourceLabel(plugin: PluginRecord) {
  if (!plugin.curated) return "AUTO";
  return plugin.topic ? "TOPIC + LIST" : "LIST";
}

function sourceClass(plugin: PluginRecord) {
  if (!plugin.curated) return "auto";
  return plugin.topic ? "topic" : "list";
}

function pluginInstallCommand(plugin: PluginRecord) {
  return withPackageRunner(displayInstallCommand(plugin.installCommand || suggestedInstallCommand(plugin), "web"), "dsh");
}

const CHECK_ITEMS = [
  ["manifest", "Manifest", "Manifest"],
  ["license", "许可证", "License"],
  ["readme", "README", "README"],
  ["lockfile", "锁文件", "Lockfile"],
  ["source", "源码检查", "Source"],
  ["securityDisclosure", "安全说明", "Security note"],
] as const;

function highlightMatch(value: string, query: string) {
  const needle = query.trim().split(/\s+/u)[0] || "";
  if (!needle) return value;
  const index = value.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="search-hit">{value.slice(index, index + needle.length)}</mark>
      {value.slice(index + needle.length)}
    </>
  );
}

function PluginDetail({
  plugin,
  lang,
  categoryLabel,
  favorite,
  copied,
  related,
  previous,
  next,
  catalogHref,
  onCopy,
  onFavorite,
  onShare,
  onOpenRelated,
}: {
  plugin: PluginRecord;
  lang: Language;
  categoryLabel: string;
  favorite: boolean;
  copied: string | null;
  related: PluginRecord[];
  previous: PluginRecord | null;
  next: PluginRecord | null;
  catalogHref: string;
  onCopy: (value: string, id: string) => void;
  onFavorite: () => void;
  onShare: () => void;
  onOpenRelated?: (plugin: PluginRecord) => void;
}) {
  const suggested = suggestedInstallCommand(plugin);
  const [profile, setProfile] = useState<"web" | "default">("web");
  const [runner, setRunner] = useState<"dsh" | "npx">("dsh");
  const command = withPackageRunner(displayInstallCommand(plugin.installCommand || suggested, profile), runner);
  return (
    <>
      <div className="plugin-drawer__badges">
        <span className={`evidence evidence--${sourceClass(plugin)}`}>{sourceLabel(plugin)}</span>
        <span className={`signal signal--${plugin.attention.level}`}>{signalLabel(plugin, lang)}</span>
      </div>
      <nav className="plugin-crumbs" aria-label={text(lang, "面包屑", "Breadcrumb")}>
        <Link href={catalogHref} prefetch={false}>{text(lang, "目录", "Catalog")}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/plugins?category=${plugin.category}`} prefetch={false}>{categoryLabel}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/plugins?owner=${encodeURIComponent(plugin.owner)}`} prefetch={false}>{plugin.owner}</Link>
      </nav>
      <h1 id="plugin-title">{visiblePluginName(plugin)}</h1>
      <p className="drawer-owner">
        <a href={plugin.url} target="_blank" rel="noreferrer">{plugin.repo}</a>
        {" · "}
        <Link href={`/plugins?owner=${encodeURIComponent(plugin.owner)}`} prefetch={false}>{plugin.owner}</Link>
        {" · "}
        <Link href={`/plugins?category=${plugin.category}`} prefetch={false}>{categoryLabel}</Link>
      </p>
      <div className="stat-chips">
        <span>★ {formatNumber(plugin.stars, lang)}</span>
        <span>{relativeDate(plugin.pushedAt, lang)}</span>
        <span>{plugin.license || text(lang, "许可证未声明", "License missing")}</span>
        <span>{plugin.language || text(lang, "语言未知", "Language unknown")}</span>
      </div>
      <p className="drawer-description" id="plugin-description">{displayDescription(plugin, lang)}</p>
      <ul className="check-pills" aria-label={text(lang, "检查项", "Checklist")}>
        {CHECK_ITEMS.map(([id, zh, en]) => (
          <li key={id} className={plugin.screening.checks[id] ? "is-on" : "is-off"}>
            <span aria-hidden="true">{plugin.screening.checks[id] ? "✓" : "–"}</span>
            {text(lang, zh, en)}
          </li>
        ))}
      </ul>

      <div className="drawer-section">
        <span className="drawer-label">{text(lang, "安装证据", "INSTALL EVIDENCE")}</span>
        {plugin.installCommand ? (
          <p>{text(lang, "命令已锁定到完成检查的 Git commit；执行前仍建议阅读完整源码。", "The command is pinned to the inspected Git commit. Review the complete source before running it.")}</p>
        ) : (
          <p className="warning-copy">{plugin.screenedCommit
            ? text(lang, "静态检查尚未通过，因此不提供正式安装命令。下面是钉到已检查提交的建议命令，执行前请先核对完整源码。", "Static screening has not passed, so no official install command is shown. The suggestion below is pinned to the inspected commit; review the complete source first.")
            : text(lang, "当前证据不足或尚未完成源码检查，网站不提供正式安装命令。下面只是仓库级建议命令，执行前请先核对完整源码。", "Evidence is currently insufficient or the source scan is still pending, so no official install command is shown. The suggestion below is repository-level only; review the complete source first.")}</p>
        )}
        <div className="install-toggles">
          <div className="profile-switch" role="group" aria-label={text(lang, "安装 profile", "Install profile")}>
            <button className={profile === "web" ? "is-active" : ""} type="button" onClick={() => setProfile("web")}>web</button>
            <button className={profile === "default" ? "is-active" : ""} type="button" onClick={() => setProfile("default")}>{text(lang, "默认", "default")}</button>
          </div>
          <div className="profile-switch" role="group" aria-label={text(lang, "运行方式", "Runner")}>
            <button className={runner === "dsh" ? "is-active" : ""} type="button" onClick={() => setRunner("dsh")}>dsh</button>
            <button className={runner === "npx" ? "is-active" : ""} type="button" onClick={() => setRunner("npx")}>npx</button>
          </div>
        </div>
        <div className="code-panel code-panel--drawer">
          <code>{command}</code>
          <button type="button" onClick={() => onCopy(command, plugin.id)}>{copied === plugin.id ? text(lang, "已复制", "Copied") : text(lang, "复制", "Copy")}</button>
        </div>
      </div>

      <div className="drawer-section">
        <span className="drawer-label">{text(lang, "自动检查结果", "AUTOMATED SCREENING")}</span>
        {plugin.screening.findings.length > 0 && <ul className="reason-list">{plugin.screening.findings.map((finding) => <li className={`reason-list__item reason-list__item--${finding.severity}`} key={finding.id}>{finding.label[lang]}{finding.files.length ? ` · ${finding.files.join(", ")}` : ""}</li>)}</ul>}
        <details className="evidence-details">
          <summary>{text(lang, "完整检查记录", "Full screening record")}</summary>
          <dl className="evidence-list">
            <div><dt>{text(lang, "检查结论", "Screening")}</dt><dd>{signalLabel(plugin, lang)} · {plugin.screening.risk.toUpperCase()}</dd></div>
            <div><dt>{text(lang, "检查范围", "Coverage")}</dt><dd>{plugin.screening.scope === "source" ? text(lang, "manifest + 声明入口源码", "manifest + declared source") : text(lang, "仅 manifest，等待补扫", "manifest only; source pending")}</dd></div>
            <div><dt>Manifest</dt><dd>{plugin.manifest.state === "verified" ? `${plugin.manifest.kinds.join(" · ")} · ${plugin.manifest.packageName || "package"}` : plugin.manifest.state}</dd></div>
            <div><dt>{text(lang, "版本", "Version")}</dt><dd>{plugin.manifest.version || "—"}</dd></div>
            <div><dt>{text(lang, "已检查提交", "Screened commit")}</dt><dd>{plugin.screenedCommit ? <button className="commit-copy" type="button" onClick={() => onCopy(plugin.screenedCommit || "", `${plugin.id}-commit`)}>{copied === `${plugin.id}-commit` ? text(lang, "已复制", "Copied") : plugin.screenedCommit.slice(0, 12)}</button> : "—"}</dd></div>
            <div><dt>{text(lang, "运行依赖", "Runtime deps")}</dt><dd>{plugin.manifest.runtimeDependencies}</dd></div>
            <div><dt>{text(lang, "生命周期脚本", "Lifecycle scripts")}</dt><dd>{plugin.manifest.lifecycleScripts.length ? plugin.manifest.lifecycleScripts.join(", ") : text(lang, "未发现", "None found")}</dd></div>
            <div><dt>{text(lang, "维护状态", "Maintenance")}</dt><dd>{maintenanceLabel(plugin, lang)}</dd></div>
            <div><dt>{text(lang, "默认分支", "Default branch")}</dt><dd>{plugin.defaultBranch || "—"}</dd></div>
            <div><dt>{text(lang, "已读文件", "Files inspected")}</dt><dd>{plugin.screening.filesInspected.length ? plugin.screening.filesInspected.join(" · ") : "—"}</dd></div>
            <div><dt>{text(lang, "检查时间", "Checked at")}</dt><dd>{plugin.screening.checkedAt.slice(0, 16).replace("T", " ")} UTC</dd></div>
          </dl>
        </details>
      </div>

      <div className="drawer-actions">
        <a className="primary-button" href={plugin.url} target="_blank" rel="noreferrer">{text(lang, "在 GitHub 打开", "Open on GitHub")} ↗</a>
        {plugin.homepage && /^https?:\/\//u.test(plugin.homepage) && (
          <a className="secondary-button" href={plugin.homepage} target="_blank" rel="noreferrer">{text(lang, "打开主页", "Open homepage")} ↗</a>
        )}
        <button className={`secondary-button ${favorite ? "is-active" : ""}`} type="button" onClick={onFavorite}>★ {text(lang, favorite ? "已收藏" : "收藏", favorite ? "Saved" : "Save")}</button>
        <button className="secondary-button" type="button" onClick={onShare}>{copied === `${plugin.id}-link` ? text(lang, "链接已复制", "Link copied") : text(lang, "分享链接", "Share link")}</button>
      </div>
      {(previous || next) && (
        <nav className="plugin-pager" aria-label={text(lang, "相邻插件", "Adjacent plugins")}>
          {previous ? (
            <Link href={pluginPath(previous)} prefetch={false} onClick={(event) => {
              if (!onOpenRelated) return;
              openInDrawer(event, () => onOpenRelated(previous));
            }}>
              <small>{text(lang, "上一个", "Previous")}</small>
              <strong>{visiblePluginName(previous)}</strong>
            </Link>
          ) : <span />}
          {next ? (
            <Link href={pluginPath(next)} prefetch={false} onClick={(event) => {
              if (!onOpenRelated) return;
              openInDrawer(event, () => onOpenRelated(next));
            }}>
              <small>{text(lang, "下一个", "Next")}</small>
              <strong>{visiblePluginName(next)}</strong>
            </Link>
          ) : <span />}
        </nav>
      )}
      {related.length > 0 && (
        <div className="drawer-section">
          <span className="drawer-label">{text(lang, "同类插件", "RELATED PLUGINS")}</span>
          <ul className="related-list">
            {related.map((item) => (
              <li key={item.id}>
                <Link href={pluginPath(item)} prefetch={false} onClick={(event) => {
                  if (!onOpenRelated) return;
                  openInDrawer(event, () => onOpenRelated(item));
                }}>
                  <strong>{visiblePluginName(item)}</strong>
                  <small>{item.repo}</small>
                  <span className={`signal signal--${item.attention.level}`}>{signalLabel(item, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="drawer-disclaimer">{text(lang, "自动检查覆盖有限文件和规则，可能漏报，也可能误报。安装插件仍会在你的机器上执行第三方代码；高权限项目请放进独立 profile 与临时工作区验证。", "Automated screening covers a limited set of files and rules, so false negatives and false positives remain possible. Plugins still execute third-party code on your machine; test high-authority projects in an isolated profile and disposable workspace.")}</p>
    </>
  );
}

function PluginCard({
  plugin,
  lang,
  favorite,
  copied,
  onOpen,
  onFavorite,
  onCopy,
  view,
  query,
  active,
  expanded,
}: {
  plugin: PluginRecord;
  lang: Language;
  favorite: boolean;
  copied: string | null;
  onOpen: () => void;
  onFavorite: () => void;
  onCopy: (value: string, id: string) => void;
  view: "list" | "cards";
  query: string;
  active?: boolean;
  expanded?: boolean;
}) {
  const command = pluginInstallCommand(plugin);
  const copyId = `${plugin.id}-card`;
  return (
    <article className={`plugin-card plugin-card--${view}${active ? " is-cursor" : ""}${expanded ? " is-open" : ""}`}>
      <Link className="plugin-card__main" href={pluginPath(plugin)} prefetch={false} onClick={(event) => openInDrawer(event, onOpen)}>
        <span className="plugin-card__number">{String(plugin.order + 1).padStart(3, "0")}</span>
        <span className="plugin-card__copy">
          <span className="plugin-card__title-row">
            <strong>{highlightMatch(visiblePluginName(plugin), query)}</strong>
            <span className={`evidence evidence--${sourceClass(plugin)}`}>
              {sourceLabel(plugin)}
            </span>
          </span>
          <span className="plugin-card__owner">{plugin.repo}</span>
          <span className="plugin-card__description">{highlightMatch(displayDescription(plugin, lang), query)}</span>
          <span className="plugin-card__meta">
            <span>★ {formatNumber(plugin.stars, lang)}</span>
            <span>{relativeDate(plugin.pushedAt, lang)}</span>
            {plugin.manifest.version && <span>v{plugin.manifest.version}</span>}
            <span>{plugin.license || text(lang, "无许可证", "No license")}</span>
            <span className={`signal signal--${plugin.attention.level}`}>{signalLabel(plugin, lang)}</span>
          </span>
          {expanded && (
            <>
              <span className="plugin-card__assay">
                {CHECK_ITEMS.map(([id, zh, en]) => (
                  <span key={id} className={plugin.screening.checks[id] ? "is-on" : "is-off"}>
                    {plugin.screening.checks[id] ? "▣" : "□"} {text(lang, zh, en)}
                  </span>
                ))}
              </span>
              <span className="plugin-card__install">
                <code>{command}</code>
              </span>
            </>
          )}
        </span>
      </Link>
      <div className="plugin-card__actions">
        <button
          className="copy-install"
          type="button"
          onClick={() => onCopy(command, copyId)}
          aria-label={plugin.installCommand ? text(lang, "复制安装命令", "Copy install command") : text(lang, "复制建议安装命令", "Copy suggested install command")}
          title={plugin.installCommand ? text(lang, "复制安装命令", "Copy install command") : text(lang, "复制建议命令，安装前请核对源码", "Copy suggested command; review source first")}
        >
          {copied === copyId ? "✓" : "⎘"}
        </button>
        <button
          className={`favorite-button ${favorite ? "is-active" : ""}`}
          type="button"
          onClick={onFavorite}
          aria-label={text(lang, favorite ? "取消收藏" : "收藏", favorite ? "Remove favorite" : "Save favorite")}
          title={text(lang, favorite ? "取消收藏" : "收藏", favorite ? "Remove favorite" : "Save favorite")}
        >
          ★
        </button>
      </div>
    </article>
  );
}

export function PluginHub({
  data: initialData,
  initialPage = "home",
  initialPluginId = null,
  initialSource = "bundled",
  initialLanguage = "zh",
  initialTheme = "light",
  initialCategoryCounts,
  initialInspectedCount,
  relatedPluginIds = [],
  initialQuery = "",
  initialCategory = "all",
  initialEvidence = "all",
  initialSort = "evidence",
  initialOwner = "",
  initialRepositoryUrl = "",
}: {
  data: PluginRegistryData;
  initialPage?: PageId;
  initialPluginId?: string | null;
  initialSource?: "bundled" | "live";
  initialLanguage?: Language;
  initialTheme?: "dark" | "light";
  initialCategoryCounts?: Record<CategoryId, number>;
  initialInspectedCount?: number;
  relatedPluginIds?: string[];
  initialQuery?: string;
  initialCategory?: "all" | CategoryId;
  initialEvidence?: EvidenceFilter;
  initialSort?: SortId;
  initialOwner?: string;
  initialRepositoryUrl?: string;
}) {
  const data = initialData;
  const [registrySource] = useState<"bundled" | "live">(initialSource);
  const [page, setPage] = useState<PageId>(initialPage);
  const [lang, setLang] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [owner, setOwner] = useState(normalizeOwnerParam(initialOwner));
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [cursor, setCursor] = useState(-1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | CategoryId>(initialCategory);
  const [sort, setSort] = useState<SortId>(["evidence", "curated", "stars", "updated", "added", "name"].includes(initialSort) ? initialSort : "evidence");
  const [homeQuery, setHomeQuery] = useState("");
  const [catalogHref, setCatalogHref] = useState("/plugins");
  const [recent, setRecent] = useState<Array<{ id: string; name: string; repo: string }>>([]);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<"list" | "cards">("list");
  const [evidence, setEvidence] = useState<EvidenceFilter>(
    EVIDENCE_FILTERS.includes(initialEvidence) ? initialEvidence : "all",
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<PluginRecord | null>(() => (
    initialPluginId ? initialData.plugins.find((plugin) => plugin.id === initialPluginId) || null : null
  ));
  const [copied, setCopied] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState(initialRepositoryUrl);
  const [preflight, setPreflight] = useState<null | {
    loading?: boolean;
    error?: string;
    repo?: string;
    topic?: boolean;
    manifest?: string;
    eligible?: boolean;
    listedId?: string | null;
  }>(null);
  const [visibleWindow, setVisibleWindow] = useState({ key: "", count: RESULT_BATCH_SIZE });
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setPage(pageFromLocation());
      const match = window.location.pathname.match(/^\/plugin\/([^/]+)\/([^/]+)\/?$/u);
      const id = match ? `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`.toLowerCase() : null;
      setSelected(id ? data.plugins.find((plugin) => plugin.id === id) || null : null);
    };
    window.addEventListener("popstate", onPopState);
    const restoreTimer = window.setTimeout(() => {
      if (window.location.hash.startsWith("#/")) {
        const legacy = window.location.hash.replace(/^#\/?/u, "").split(/[/?]/u)[0];
        const next = Object.hasOwn(PAGE_PATHS, legacy) ? PAGE_PATHS[legacy as Exclude<PageId, "plugin">] : "/";
        window.history.replaceState(null, "", next);
        setPage(pageFromLocation());
      }
      const params = new URLSearchParams(window.location.search);
      const initialCategory = params.get("category");
      const initialSort = params.get("sort");
      const initialEvidence = params.get("evidence");
      setQuery(params.get("q") || "");
      setOwner(normalizeOwnerParam(params.get("owner") || ""));
      if (initialCategory === "all" || CATEGORY_ORDER.includes(initialCategory as CategoryId)) setCategory(initialCategory as "all" | CategoryId);
      if (["evidence", "curated", "stars", "updated", "added", "name"].includes(initialSort || "")) setSort(initialSort as SortId);
      if (EVIDENCE_FILTERS.includes((initialEvidence || "") as EvidenceFilter)) setEvidence(initialEvidence as EvidenceFilter);
      try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
        if (saved.lang === "zh" || saved.lang === "en") setLang(saved.lang);
        if (saved.theme === "dark" || saved.theme === "light") setTheme(saved.theme);
        if (saved.view === "list" || saved.view === "cards") setView(saved.view);
        else if (window.matchMedia("(max-width: 760px)").matches) setView("list");
        if (Array.isArray(saved.favorites)) setFavorites(saved.favorites);
        const catalogReturn = sessionStorage.getItem(CATALOG_RETURN_KEY);
        if (catalogReturn?.startsWith("/plugins")) setCatalogHref(catalogReturn);
        const storedRecent = JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]");
        if (Array.isArray(storedRecent)) {
          setRecent(storedRecent.filter((item) => item && typeof item.id === "string" && typeof item.repo === "string").slice(0, 6));
        }
      } catch {
        // Keep defaults when a browser contains malformed old preferences.
      } finally {
        setPreferencesReady(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("popstate", onPopState);
    };
  }, [data.plugins]);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    if (!preferencesReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ lang, theme, view, favorites }));
      document.cookie = `dsh-plugin-hub-lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
      document.cookie = `dsh-plugin-hub-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Preferences are optional when storage is unavailable.
    }
  }, [favorites, lang, preferencesReady, theme, view]);

  useEffect(() => {
    const pageTitle = selected ? visiblePluginName(selected) : PAGES.find((item) => item.id === page)?.[lang] || "DSH";
    const site = text(lang, "DSH 插件资源站", "DSH Plugin Hub");
    if (page === "home" && !selected) document.title = site;
    else if (page === "catalog" && !selected) {
      const label = catalogPageTitle({
        query,
        category,
        owner,
        lang,
        categories: data.categories,
        fallback: text(lang, "插件目录", "Plugin catalog"),
      });
      document.title = `${label} · ${site}`;
    } else document.title = `${pageTitle} · ${site}`;
  }, [category, data.categories, lang, owner, page, query, selected]);

  const rememberRecent = useCallback((plugin: PluginRecord) => {
    const item = { id: plugin.id, name: visiblePluginName(plugin), repo: plugin.repo };
    setRecent((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 6);
      try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
  }, []);

  const openPlugin = useCallback((plugin: PluginRecord) => {
    rememberRecent(plugin);
    if (page === "catalog" && !preferDedicatedPluginPage()) {
      setExpandedId((current) => (current === plugin.id ? null : plugin.id));
      return;
    }
    window.location.assign(pluginPath(plugin));
  }, [page, rememberRecent]);

  const closeSelected = useCallback(() => {
    if (page === "plugin") {
      window.history.pushState(null, "", catalogHref);
      setPage("catalog");
      setSelected(null);
      return;
    }
    if (window.history.state?.drawer) window.history.back();
    else {
      window.history.replaceState(null, "", PAGE_PATHS.catalog);
      setPage("catalog");
      setSelected(null);
    }
  }, [catalogHref, page]);

  useEffect(() => {
    if (!selected || page === "plugin") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSelected();
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    returnFocusRef.current ||= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [closeSelected, page, selected]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((current) => {
      const exists = current.includes(id);
      const next = exists ? current.filter((item) => item !== id) : [...current, id];
      setCopyMessage(exists ? text(lang, "已取消收藏", "Removed from saved") : text(lang, "已加入收藏", "Saved to favorites"));
      window.setTimeout(() => setCopyMessage(""), 1800);
      return next;
    });
  }, [lang]);

  const copy = useCallback(async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setCopyMessage(text(lang, "已复制到剪贴板", "Copied to clipboard"));
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
      window.setTimeout(() => setCopyMessage(""), 2200);
    } catch {
      setCopied(null);
      setCopyMessage(text(lang, "复制失败，请手动复制", "Copy failed; copy manually"));
      window.setTimeout(() => setCopyMessage(""), 3200);
    }
  }, [lang]);

  const runPreflight = useCallback(async (url: string) => {
    setPreflight({ loading: true });
    try {
      const response = await fetch("/api/repository/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = await response.json() as { error?: string; repo?: string; topic?: boolean; manifest?: string; eligible?: boolean; listedId?: string | null };
      if (!response.ok) throw new Error(result.error || text(lang, "检查失败", "Check failed"));
      setPreflight(result);
    } catch (error) {
      setPreflight({ error: error instanceof Error ? error.message : text(lang, "检查失败", "Check failed") });
    }
  }, [lang]);

  const checkRepository = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runPreflight(repositoryUrl);
  }, [repositoryUrl, runPreflight]);

  const preCategory = useMemo(() => {
    const favoriteSet = new Set(favorites);
    return data.plugins.filter((plugin) => {
      if (evidence === "auto" && plugin.curated) return false;
      if (evidence === "topic" && !plugin.topic) return false;
      if (evidence === "manifest" && plugin.manifest.state !== "verified") return false;
      if (evidence === "clear" && plugin.screening.state !== "clear") return false;
      if (evidence === "installable" && !plugin.installCommand) return false;
      if (evidence === "review" && !["review", "pending", "blocked"].includes(plugin.screening.state)) return false;
      if (evidence === "favorites" && !favoriteSet.has(plugin.id)) return false;
      if (owner && plugin.owner.toLowerCase() !== owner.toLowerCase()) return false;
      return matchesSearchQuery(
        pluginSearchHaystack(plugin, [
          data.categories[plugin.category]?.zh || "",
          data.categories[plugin.category]?.en || "",
          CATEGORY_HINTS[plugin.category]?.zh || "",
          CATEGORY_HINTS[plugin.category]?.en || "",
        ]),
        query,
      );
    });
  }, [data.categories, data.plugins, evidence, favorites, owner, query]);

  const computedCategoryCounts = useMemo(() => {
    const counts = Object.fromEntries(CATEGORY_ORDER.map((id) => [id, 0])) as Record<CategoryId, number>;
    for (const plugin of (page === "catalog" ? preCategory : data.plugins)) {
      if (plugin.category in counts) counts[plugin.category] += 1;
    }
    return counts;
  }, [data.plugins, page, preCategory]);
  const categoryCounts = page === "home" && initialCategoryCounts ? initialCategoryCounts : computedCategoryCounts;

  const filtered = useMemo(() => {
    const rows = category === "all" ? [...preCategory] : preCategory.filter((plugin) => plugin.category === category);
    return rows.sort((a, b) => {
      if (sort === "stars") return (b.stars ?? -1) - (a.stars ?? -1) || a.order - b.order;
      if (sort === "updated") return Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0");
      if (sort === "added") return (b.added || "").localeCompare(a.added || "") || a.order - b.order;
      if (sort === "name") {
        return visiblePluginName(a).localeCompare(visiblePluginName(b), lang === "zh" ? "zh-CN" : "en", { sensitivity: "base" });
      }
      if (sort === "curated") return a.order - b.order;
      return comparePluginsByEvidence(a, b);
    });
  }, [category, lang, preCategory, sort]);

  useEffect(() => {
    if (!preferencesReady || page !== "catalog" || selected) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (owner) params.set("owner", owner);
    if (category !== "all") params.set("category", category);
    if (sort !== "evidence") params.set("sort", sort);
    if (evidence !== "all") params.set("evidence", evidence);
    const search = params.toString();
    const next = `${PAGE_PATHS.catalog}${search ? `?${search}` : ""}`;
    window.history.replaceState(null, "", next);
    try { sessionStorage.setItem(CATALOG_RETURN_KEY, next); } catch { /* optional */ }
    setCatalogHref(next);
  }, [category, evidence, owner, page, preferencesReady, query, selected, sort]);

  const suggestions = useMemo(() => {
    const needle = query.trim();
    if (page !== "catalog" || needle.length < 2) return [] as Array<
      | { type: "plugin"; plugin: PluginRecord }
      | { type: "owner"; owner: string; count: number }
      | { type: "category"; id: CategoryId; label: string }
    >;
    const pluginHits = filtered.slice(0, 5).map((plugin) => ({ type: "plugin" as const, plugin }));
    const ownerCounts = new Map<string, number>();
    for (const plugin of data.plugins) {
      if (plugin.owner.toLowerCase().includes(needle.toLowerCase())) {
        ownerCounts.set(plugin.owner, (ownerCounts.get(plugin.owner) || 0) + 1);
      }
    }
    const ownerHits = [...ownerCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ type: "owner" as const, owner: name, count }));
    const categoryHits = CATEGORY_ORDER
      .filter((id) => {
        const label = data.categories[id]?.[lang] || "";
        const hint = CATEGORY_HINTS[id][lang];
        return `${id} ${label} ${hint}`.toLowerCase().includes(needle.toLowerCase());
      })
      .slice(0, 2)
      .map((id) => ({ type: "category" as const, id, label: data.categories[id]?.[lang] || id }));
    return [...categoryHits, ...ownerHits, ...pluginHits].slice(0, 8);
  }, [data.categories, data.plugins, filtered, lang, page, query]);

  const applySuggestion = useCallback((item: typeof suggestions[number]) => {
    if (item.type === "plugin") {
      setSuggestOpen(false);
      openPlugin(item.plugin);
      return;
    }
    if (item.type === "owner") {
      setOwner(item.owner);
      setQuery("");
    } else {
      setCategory(item.id);
      setQuery("");
    }
    setSuggestOpen(false);
    setSuggestIndex(-1);
  }, [openPlugin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && page === "catalog" && (suggestOpen || query.trim())) {
        event.preventDefault();
        if (suggestOpen) {
          setSuggestOpen(false);
          setSuggestIndex(-1);
          return;
        }
        setQuery("");
        return;
      }
      if (page === "catalog" && suggestOpen && suggestions.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSuggestIndex((current) => {
            const last = suggestions.length - 1;
            if (event.key === "ArrowDown") return current < last ? current + 1 : 0;
            return current > 0 ? current - 1 : last;
          });
          return;
        }
        if (event.key === "Enter" && suggestIndex >= 0 && suggestions[suggestIndex]) {
          event.preventDefault();
          applySuggestion(suggestions[suggestIndex]);
          return;
        }
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const input = document.querySelector<HTMLInputElement>(page === "home" ? ".hero-search input" : ".catalog-toolbar input");
      if (!input) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applySuggestion, page, query, suggestIndex, suggestOpen, suggestions]);

  const relatedPlugins = useMemo(() => {
    if (!selected) return [];
    if (relatedPluginIds.length) {
      const listed = relatedPluginIds
        .map((id) => data.plugins.find((plugin) => plugin.id === id))
        .filter((plugin): plugin is PluginRecord => Boolean(plugin));
      if (listed.length) return listed;
    }
    return selectRelatedPlugins(data.plugins, selected, 3);
  }, [data.plugins, relatedPluginIds, selected]);

  const shareSelected = useCallback(async () => {
    if (!selected) return;
    const url = `${window.location.origin}${pluginPath(selected)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: visiblePluginName(selected), url });
        return;
      } catch {
        // Fall through to clipboard copy when the share sheet is dismissed or unavailable.
      }
    }
    copy(url, `${selected.id}-link`);
  }, [copy, selected]);

  useEffect(() => {
    if (selected) rememberRecent(selected);
  }, [rememberRecent, selected]);

  const filterKey = `${query}\u0000${category}\u0000${sort}\u0000${evidence}\u0000${owner}`;
  const visibleCount = visibleWindow.key === filterKey ? visibleWindow.count : RESULT_BATCH_SIZE;
  const visiblePlugins = filtered.slice(0, visibleCount);
  const hasMore = visiblePlugins.length < filtered.length;

  useEffect(() => {
    setCursor(-1);
    setExpandedId(null);
  }, [filterKey]);

  useEffect(() => {
    if (page !== "catalog" || selected) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      if (typing || suggestOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((current) => Math.min((current < 0 ? -1 : current) + 1, visiblePlugins.length - 1));
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((current) => Math.max(current < 0 ? 0 : current - 1, 0));
      }
      if (event.key === "Enter" && cursor >= 0 && visiblePlugins[cursor]) {
        event.preventDefault();
        openPlugin(visiblePlugins[cursor]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, openPlugin, page, selected, suggestOpen, visiblePlugins]);

  useEffect(() => {
    if (cursor < 0) return;
    const node = document.querySelectorAll<HTMLElement>(".plugin-card")[cursor];
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const inspectedCount = initialInspectedCount
    ?? data.plugins.filter((plugin) => plugin.screening.scope === "source").length;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || page !== "catalog") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleWindow((current) => {
        const count = current.key === filterKey ? current.count : RESULT_BATCH_SIZE;
        if (count >= filtered.length) return current;
        return { key: filterKey, count: count + RESULT_BATCH_SIZE };
      });
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [filterKey, filtered.length, hasMore, page]);

  const topStars = useMemo(
    () => [...data.plugins].filter((plugin) => plugin.stars !== null && plugin.screening.state !== "blocked").sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 20),
    [data.plugins],
  );
  const topFresh = useMemo(
    () => [...data.plugins].filter((plugin) => plugin.pushedAt && plugin.screening.state !== "blocked").sort((a, b) => Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0")).slice(0, 20),
    [data.plugins],
  );
  const featured = page === "home" ? data.plugins.slice(0, 6) : topStars.slice(0, 6);
  const newcomers = page === "home" ? data.plugins.slice(6) : [];

  const browseList = page === "catalog" ? filtered : page === "rank" ? data.plugins : selected ? [selected, ...relatedPlugins.filter((plugin) => plugin.id !== selected.id)] : [];
  const selectedIndex = selected ? browseList.findIndex((plugin) => plugin.id === selected.id) : -1;
  const previousPlugin = selectedIndex > 0 ? browseList[selectedIndex - 1] : null;
  const nextPlugin = selectedIndex >= 0 && selectedIndex < browseList.length - 1 ? browseList[selectedIndex + 1] : null;

  useEffect(() => {
    if (!selected || page === "plugin") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && previousPlugin) {
        event.preventDefault();
        openPlugin(previousPlugin);
      }
      if (event.key === "ArrowRight" && nextPlugin) {
        event.preventDefault();
        openPlugin(nextPlugin);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextPlugin, openPlugin, page, previousPlugin, selected]);

  useEffect(() => {
    if (page !== "submit" || !initialRepositoryUrl) return;
    void runPreflight(initialRepositoryUrl);
  }, [initialRepositoryUrl, page, runPreflight]);
  const generatedLabel = data.generatedAt.slice(0, 16).replace("T", " ") + " UTC";
  const automationLabel = data.automation.state === "live"
    ? text(lang, "自动同步正常", "Automated sync healthy")
    : data.automation.state === "degraded"
      ? text(lang, "巡检部分降级", "Scan partially degraded")
      : text(lang, "等待首次自动巡检", "Awaiting first automated scan");
  const channelLabel = registrySource === "live"
    ? text(lang, "实时目录", "Live registry")
    : text(lang, "内置数据兜底", "Bundled fallback");

  return (
    <div className="hub" data-theme={theme} data-lang={lang} data-page={page}>
      <a className="skip-link" href="#main-content">{text(lang, "跳到主要内容", "Skip to content")}</a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" href="/" prefetch={false}>
            <span className="brand__mark">dsh</span>
            <span className="brand__name">{text(lang, "插件资源站", "Plugin Hub")}</span>
            <span className="sr-only">{text(lang, "，返回首页", ", back home")}</span>
          </Link>
          <nav className="main-nav" aria-label={text(lang, "主导航", "Main navigation")}>
            {PAGES.map((item) => (
              <Link
                className={page === item.id ? "is-active" : ""}
                href={item.id === "catalog" ? catalogHref : PAGE_PATHS[item.id]}
                prefetch={false}
                key={item.id}
                aria-current={page === item.id ? "page" : undefined}
              >
                {item[lang]}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link
              className={`favorite-link ${evidence === "favorites" ? "is-active" : ""}`}
              href="/plugins?evidence=favorites"
              prefetch={false}
              title={text(lang, "查看收藏", "View favorites")}
              aria-label={text(lang, `查看收藏，${favorites.length} 项`, `View ${favorites.length} saved plugins`)}
            >
              ★ <span>{favorites.length}</span>
            </Link>
            <button type="button" onClick={() => setLang((current) => (current === "zh" ? "en" : "zh"))} aria-label={text(lang, "切换到英文", "Switch to Chinese")}>
              {lang === "zh" ? "EN" : "中文"}
            </button>
            <button type="button" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} aria-label={text(lang, "切换主题", "Toggle theme")}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content">
        {page === "home" && (
          <>
            <section className="hero">
              <div className="shell hero__content">
                <h1><span>{text(lang, "一切皆插件。", "Everything is a plugin.")}</span><span>{text(lang, "先看证据，再决定装不装。", "Check the evidence before you install.")}</span></h1>
                <p>
                  {text(
                    lang,
                    `当前展示 ${data.summary.listed} 个插件，其中 ${data.summary.autoDiscovered} 个由网站自动发现；每 30 分钟检查 GitHub 元数据、manifest、安装脚本和声明入口源码。`,
                    `${data.summary.listed} plugins are listed, including ${data.summary.autoDiscovered} found automatically. GitHub metadata, manifests, install scripts, and declared source entrypoints are checked every 30 minutes.`,
                  )}
                </p>
                <form className="hero-search" action="/plugins" method="get" onSubmit={(event) => {
                  event.preventDefault();
                  const next = homeQuery.trim();
                  window.location.assign(next ? `/plugins?q=${encodeURIComponent(next)}` : "/plugins");
                }}>
                  <label className="search-field">
                    <span>/</span>
                    <input
                      name="q"
                      value={homeQuery}
                      onChange={(event) => setHomeQuery(event.target.value)}
                      aria-label={text(lang, "搜索插件", "Search plugins")}
                      placeholder={text(lang, "搜索名称、作者、仓库或能力，按 / 聚焦", "Search name, author, repo, or capability. Press /")}
                    />
                  </label>
                  <button className="primary-button" type="submit">{text(lang, "搜索插件", "Search plugins")}</button>
                </form>
                <div className="category-grid">
                  {CATEGORY_ORDER.map((id) => (
                    <Link className="category-card" href={`/plugins?category=${id}`} prefetch={false} key={id}>
                      <strong>{categoryCounts[id]}</strong>
                      <span>{data.categories[id]?.[lang] || id}</span>
                    </Link>
                  ))}
                </div>
                <p className="hero-meta">{channelLabel} · {inspectedCount}/{data.summary.listed} {text(lang, "已完成源码级检查", "source-level checks complete")} · {automationLabel} · <Link href="/plugins" prefetch={false}>{text(lang, "浏览全部插件", "Browse all")}</Link></p>
              </div>
            </section>

            <section className="section shell index-list">
              <div className="section-heading">
                <div><h2>{text(lang, "已通过检查的热门插件", "Popular plugins that passed screening")}</h2></div>
                <Link className="text-button" href="/rank" prefetch={false}>{text(lang, "完整排行榜", "Full leaderboard")} →</Link>
              </div>
              <div className="featured-grid">
                {featured.map((plugin, index) => (
                  <article className="featured-card" key={plugin.id}>
                    <Link className="featured-card__main" href={pluginPath(plugin)} prefetch={false} onClick={(event) => openInDrawer(event, () => openPlugin(plugin))}>
                      <span className="featured-card__rank">0{index + 1}</span>
                      <span className="featured-card__head"><strong>{visiblePluginName(plugin)}</strong><em>★ {formatNumber(plugin.stars, lang)}</em></span>
                      <span className="featured-card__owner">{plugin.repo}</span>
                      <span className={`signal signal--${plugin.attention.level}`}>{signalLabel(plugin, lang)}</span>
                      <span className="featured-card__desc">{displayDescription(plugin, lang)}</span>
                      <span className="featured-card__foot">{data.categories[plugin.category][lang]} <i>→</i></span>
                    </Link>
                    <button
                      className="copy-install"
                      type="button"
                      onClick={() => copy(pluginInstallCommand(plugin), `${plugin.id}-home`)}
                      aria-label={text(lang, "复制安装命令", "Copy install command")}
                    >
                      {copied === `${plugin.id}-home` ? "✓" : "⎘"}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            {newcomers.length > 0 && (
              <section className="section shell">
                <div className="section-heading">
                  <div><h2>{text(lang, "最近收录", "Newly listed")}</h2></div>
                  <Link className="text-button" href="/plugins?sort=added" prefetch={false}>{text(lang, "按收录时间看", "Browse by added")} →</Link>
                </div>
                <ul className="recent-list">
                  {newcomers.map((plugin) => (
                    <li key={plugin.id}>
                      <Link href={pluginPath(plugin)} prefetch={false} onClick={(event) => openInDrawer(event, () => openPlugin(plugin))}>
                        <strong>{visiblePluginName(plugin)}</strong>
                        <small>{plugin.repo} · {relativeDate(plugin.added, lang)}</small>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recent.length > 0 && (
              <section className="section shell recent-section">
                <div className="section-heading"><div><h2>{text(lang, "最近看过", "Recently viewed")}</h2></div></div>
                <ul className="recent-list">
                  {recent.map((item) => (
                    <li key={item.id}><Link href={`/plugin/${item.id.split("/").map(encodeURIComponent).join("/")}`} prefetch={false}><strong>{item.name}</strong><small>{item.repo}</small></Link></li>
                  ))}
                </ul>
              </section>
            )}

            <section className="section shell source-panel">
              <p>{text(lang, "网站只读取公开元数据、manifest、README 与少量声明入口源码。扫描过程不安装依赖、不运行 lifecycle，也不执行插件代码；结果属于轻量静态检查。", "The hub reads public metadata, manifests, READMEs, and a small set of declared source entrypoints. It installs no dependencies, runs no lifecycle scripts, and executes no plugin code. Results are lightweight static checks.")}</p>
            </section>
          </>
        )}

        {page === "catalog" && (
          <section className="catalog shell page-section">
            <div className="page-heading">
              <div>
                <h1>{catalogPageTitle({
                  query,
                  category,
                  owner,
                  lang,
                  categories: data.categories,
                  fallback: text(lang, "插件目录", "Plugin catalog"),
                })}</h1>
                <p aria-live="polite">
                  {text(lang, `${filtered.length} 个结果 · 数据生成于 ${generatedLabel}`, `${filtered.length} results · generated ${generatedLabel}`)}
                  {category !== "all" && !query.trim() && !owner ? ` · ${CATEGORY_HINTS[category][lang]}` : ""}
                </p>
              </div>
              <button className="text-button" type="button" onClick={() => copy(`${window.location.origin}${catalogHref}`, "catalog-link")}>
                {copied === "catalog-link" ? text(lang, "链接已复制", "Link copied") : text(lang, "复制筛选链接", "Copy filter link")}
              </button>
            </div>
            <div className="catalog-layout">
              <aside className="catalog-aside" aria-label={text(lang, "筛选", "Filters")}>
                <div className="category-chips">
                  <Link
                    className={category === "all" ? "is-active" : ""}
                    href={catalogHrefFor({ query, owner, category: "all", sort, evidence })}
                    prefetch={false}
                    onClick={(event) => { event.preventDefault(); setCategory("all"); }}
                    aria-current={category === "all" ? "page" : undefined}
                  >
                    {text(lang, "全部", "All")} <small>{preCategory.length}</small>
                  </Link>
                  {CATEGORY_ORDER.map((id) => (
                    <Link
                      className={category === id ? "is-active" : ""}
                      href={catalogHrefFor({ query, owner, category: id, sort, evidence })}
                      prefetch={false}
                      key={id}
                      onClick={(event) => { event.preventDefault(); setCategory(id); }}
                      aria-current={category === id ? "page" : undefined}
                    >
                      {data.categories[id][lang]} <small>{categoryCounts[id]}</small>
                    </Link>
                  ))}
                </div>
                <label className="aside-field">
                  <span>{text(lang, "证据", "Evidence")}</span>
                  <select value={evidence} onChange={(event) => setEvidence(event.target.value as EvidenceFilter)} aria-label={text(lang, "证据筛选", "Evidence filter")}>
                    <option value="all">{text(lang, "全部证据状态", "All evidence")}</option>
                    <option value="auto">{text(lang, "网站自动发现", "Auto-discovered")}</option>
                    <option value="topic">{text(lang, "已匹配 GitHub 话题", "Matched GitHub topic")}</option>
                    <option value="manifest">{text(lang, "已识别 manifest", "Manifest found")}</option>
                    <option value="clear">{text(lang, "静态检查通过", "Static scan clear")}</option>
                    <option value="installable">{text(lang, "可正式安装", "Official install")}</option>
                    <option value="review">{text(lang, "待复核或已拦截", "Review or blocked")}</option>
                    <option value="favorites">{text(lang, "只看收藏", "Favorites only")}</option>
                  </select>
                </label>
                <label className="aside-field">
                  <span>{text(lang, "排序", "Sort")}</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as SortId)} aria-label={text(lang, "排序", "Sort") }>
                    <option value="evidence">{text(lang, "按证据优先", "Evidence first")}</option>
                    <option value="curated">{text(lang, "精选顺序", "Curated order")}</option>
                    <option value="stars">{text(lang, "按星标", "By stars")}</option>
                    <option value="updated">{text(lang, "最近更新", "Recently pushed")}</option>
                    <option value="added">{text(lang, "最近收录", "Recently added")}</option>
                    <option value="name">{text(lang, "名称 A→Z", "Name A→Z")}</option>
                  </select>
                </label>
              </aside>
              <div className="catalog-main">
                <div className="catalog-toolbar">
                  <div className="search-combo">
                    <label className="search-field">
                      <span>/</span>
                      <input
                        name="q"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setSuggestOpen(true);
                          setSuggestIndex(-1);
                        }}
                        onFocus={() => setSuggestOpen(true)}
                        onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
                        aria-label={text(lang, "搜索插件", "Search plugins")}
                        aria-autocomplete="list"
                        aria-expanded={suggestOpen && suggestions.length > 0}
                        aria-controls="catalog-suggest"
                        placeholder={text(lang, "搜索名称、作者、仓库或能力，Esc 清空", "Search name, author, repo, or capability. Esc clears")}
                      />
                      {query && <button type="button" onClick={() => { setQuery(""); setSuggestOpen(false); }} aria-label={text(lang, "清空搜索", "Clear search")}>×</button>}
                    </label>
                    {suggestOpen && suggestions.length > 0 && (
                      <ul className="search-suggest" id="catalog-suggest" role="listbox">
                        {suggestions.map((item, index) => (
                          <li key={item.type === "plugin" ? item.plugin.id : item.type === "owner" ? `owner:${item.owner}` : `category:${item.id}`} role="option" aria-selected={index === suggestIndex}>
                            <button
                              className={index === suggestIndex ? "is-active" : ""}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => applySuggestion(item)}
                            >
                              {item.type === "plugin" && (
                                <>
                                  <strong>{visiblePluginName(item.plugin)}</strong>
                                  <small>{item.plugin.repo}</small>
                                </>
                              )}
                              {item.type === "owner" && (
                                <>
                                  <strong>{item.owner}</strong>
                                  <small>{text(lang, `${item.count} 个插件`, `${item.count} plugins`)}</small>
                                </>
                              )}
                              {item.type === "category" && (
                                <>
                                  <strong>{item.label}</strong>
                                  <small>{text(lang, "分类", "Category")}</small>
                                </>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="view-switch" role="group" aria-label={text(lang, "视图", "View") }>
                    <button className={view === "list" ? "is-active" : ""} type="button" onClick={() => setView("list")} aria-label={text(lang, "列表视图", "List view")} aria-pressed={view === "list"}>☰</button>
                    <button className={view === "cards" ? "is-active" : ""} type="button" onClick={() => setView("cards")} aria-label={text(lang, "卡片视图", "Card view")} aria-pressed={view === "cards"}>▦</button>
                  </div>
                </div>
                {(query.trim() || owner || category !== "all" || evidence !== "all") && (
                  <div className="filter-summary">
                    {query.trim() && <button type="button" onClick={() => setQuery("")}>{text(lang, `搜索：${query.trim()}`, `Search: ${query.trim()}`)} ×</button>}
                    {owner && <button type="button" onClick={() => setOwner("")}>{text(lang, `作者：${owner}`, `Owner: ${owner}`)} ×</button>}
                    {category !== "all" && <button type="button" onClick={() => setCategory("all")}>{data.categories[category][lang]} ×</button>}
                    {evidence !== "all" && <button type="button" onClick={() => setEvidence("all")}>{text(lang, evidence === "clear" ? "检查通过" : evidence === "installable" ? "可正式安装" : evidence === "review" ? "待复核" : evidence === "favorites" ? "收藏" : evidence, evidence === "installable" ? "Official install" : evidence)} ×</button>}
                    <button type="button" onClick={() => { setQuery(""); setOwner(""); setCategory("all"); setEvidence("all"); }}>{text(lang, "清除全部", "Clear all")}</button>
                  </div>
                )}
                {filtered.length ? (
                  <div className={`plugin-results plugin-results--${view}`}>
                    {visiblePlugins.map((plugin) => (
                      <PluginCard
                        key={plugin.id}
                        plugin={plugin}
                        lang={lang}
                        favorite={favorites.includes(plugin.id)}
                        copied={copied}
                        onOpen={() => openPlugin(plugin)}
                        onFavorite={() => toggleFavorite(plugin.id)}
                        onCopy={copy}
                        view={view}
                        query={query}
                        active={cursor >= 0 && visiblePlugins[cursor]?.id === plugin.id}
                        expanded={expandedId === plugin.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>{evidence === "favorites" && favorites.length === 0 ? text(lang, "还没有收藏", "No saved plugins yet") : text(lang, "没有匹配的插件", "No matching plugins")}</strong>
                    <p>{evidence === "favorites" && favorites.length === 0 ? text(lang, "在卡片右侧点星标，就能在这里集中查看。", "Tap the star on a card to save it here.") : text(lang, "换个关键词或清空筛选条件。", "Try another keyword or reset the filters.")}</p>
                    <button type="button" onClick={() => { setQuery(""); setOwner(""); setCategory("all"); setEvidence("all"); }}>{text(lang, "清空筛选", "Reset filters")}</button>
                    <div className="empty-state__hints">
                      {CATEGORY_ORDER.slice(0, 6).map((id) => (
                        <button key={id} type="button" onClick={() => { setQuery(""); setOwner(""); setCategory(id); setEvidence("all"); }}>
                          {data.categories[id][lang]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {hasMore && <button ref={loadMoreRef} className="load-more" type="button" onClick={() => setVisibleWindow({ key: filterKey, count: visibleCount + RESULT_BATCH_SIZE })}>{text(lang, `加载更多（还有 ${filtered.length - visiblePlugins.length} 个）`, `Load more (${filtered.length - visiblePlugins.length} remaining)`)}</button>}
              </div>
            </div>
          </section>
        )}

        {page === "rank" && (
          <section className="shell page-section">
            <div className="page-heading">
              <div><h1>{text(lang, "排行榜", "Leaderboard")}</h1><p>{text(lang, "星标与推送时间来自 GitHub。它们代表关注度和活跃度，不代表安全或质量。", "Stars and push times come from GitHub. They signal attention and activity, not safety or quality.")}</p></div>
            </div>
            <div className="rank-grid">
              <div className="rank-panel">
                <div className="rank-panel__heading"><span>★</span><div><h2>{text(lang, "按星标", "By stars")}</h2><p>{text(lang, "社区关注度", "Community attention")}</p></div><Link className="text-button" href="/plugins?sort=stars" prefetch={false}>{text(lang, "目录中查看", "Open catalog")} →</Link></div>
                <ol>{topStars.map((plugin, index) => (
                  <li key={plugin.id}>
                    <Link href={pluginPath(plugin)} prefetch={false} onClick={(event) => openInDrawer(event, () => openPlugin(plugin))}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span><strong>{visiblePluginName(plugin)}</strong><small>{plugin.repo} · {data.categories[plugin.category][lang]}</small></span>
                      <em>★ {formatNumber(plugin.stars, lang)}</em>
                      <span className={`signal signal--${plugin.attention.level}`}>{signalLabel(plugin, lang)}</span>
                    </Link>
                    <button className="copy-install" type="button" onClick={() => copy(pluginInstallCommand(plugin), `${plugin.id}-rank`)} aria-label={text(lang, "复制安装命令", "Copy install command")}>{copied === `${plugin.id}-rank` ? "✓" : "⎘"}</button>
                  </li>
                ))}</ol>
              </div>
              <div className="rank-panel">
                <div className="rank-panel__heading"><span>↻</span><div><h2>{text(lang, "最近更新", "Recently pushed")}</h2><p>{text(lang, "维护活跃度", "Maintenance activity")}</p></div><Link className="text-button" href="/plugins?sort=updated" prefetch={false}>{text(lang, "目录中查看", "Open catalog")} →</Link></div>
                <ol>{topFresh.map((plugin, index) => (
                  <li key={plugin.id}>
                    <Link href={pluginPath(plugin)} prefetch={false} onClick={(event) => openInDrawer(event, () => openPlugin(plugin))}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span><strong>{visiblePluginName(plugin)}</strong><small>{plugin.repo} · {data.categories[plugin.category][lang]}</small></span>
                      <em>{relativeDate(plugin.pushedAt, lang)}</em>
                      <span className={`signal signal--${plugin.attention.level}`}>{signalLabel(plugin, lang)}</span>
                    </Link>
                    <button className="copy-install" type="button" onClick={() => copy(pluginInstallCommand(plugin), `${plugin.id}-fresh`)} aria-label={text(lang, "复制安装命令", "Copy install command")}>{copied === `${plugin.id}-fresh` ? "✓" : "⎘"}</button>
                  </li>
                ))}</ol>
              </div>
            </div>
          </section>
        )}

        {page === "submit" && (
          <section className="shell page-section prose-page">
            <div className="page-heading"><div><h1>{text(lang, "让你的插件被看见", "Get your plugin listed")}</h1><p>{text(lang, "收录走公开仓库链路，站点不接收代码上传。", "Listing follows public repository workflows; this site accepts no code uploads.")}</p></div></div>
            <div className="process-grid">
              {[
                ["01", "dsh-plugin", "给 GitHub 仓库添加 dsh-plugin topic。", "Add the dsh-plugin topic to your GitHub repository."],
                ["02", "README + LICENSE", "写清功能、权限、关闭方式和许可证。", "Document behavior, permissions, removal, and license."],
                ["03", "dsh manifest", "在 package.json 声明 dsh.bundle / plugin / profile。", "Declare dsh.bundle / plugin / profile in package.json."],
                ["04", "AUTO SCAN", "网站每 30 分钟发现一次，并按 manifest、安装脚本和入口源码信号分级。", "The site discovers repositories every 30 minutes and grades manifest, install-script, and entrypoint signals."],
              ].map(([no, title, zh, en]) => <div className="process-card" key={no}><b>{no}</b><strong>{title}</strong><p>{text(lang, zh, en)}</p></div>)}
            </div>
            <form className="repository-check" onSubmit={checkRepository}>
              <div><h2>{text(lang, "先检查仓库是否满足收录条件", "Check listing readiness")}</h2><p>{text(lang, "这里只读取公开仓库信息和 package.json，不执行任何代码。", "This reads public repository metadata and package.json only; no code is executed.")}</p></div>
              <label><span>{text(lang, "GitHub 仓库地址", "GitHub repository URL")}</span><div><input type="url" required maxLength={300} value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} aria-label={text(lang, "GitHub 仓库地址", "GitHub repository URL")} placeholder="https://github.com/owner/repository" /><button className="primary-button" type="submit" disabled={preflight?.loading}>{preflight?.loading ? text(lang, "检查中…", "Checking…") : text(lang, "立即检查", "Check now")}</button></div></label>
              {preflight && !preflight.loading && <div className={`repository-result ${preflight.error ? "is-error" : preflight.listedId || preflight.eligible ? "is-clear" : "is-review"}`} role="status">
                {preflight.error ? <p>{preflight.error}</p> : <><strong>{preflight.listedId ? text(lang, "这个仓库已经在目录里", "This repository is already listed") : preflight.eligible ? text(lang, "已满足自动发现条件", "Ready for automatic discovery") : text(lang, "还需要补充信息", "More information is needed")}</strong><ul><li>{text(lang, "dsh-plugin Topic", "dsh-plugin topic")}：{preflight.topic ? "✓" : "×"}</li><li>DSH manifest：{preflight.manifest === "verified" ? "✓" : preflight.manifest}</li></ul>{preflight.listedId ? <p><Link href={`/plugin/${preflight.listedId.split("/").map(encodeURIComponent).join("/")}`}>{text(lang, "查看插件详情", "Open plugin page")} →</Link></p> : !preflight.eligible ? <p><Link href="/guide">{text(lang, "查看开发指南", "Read the guide")} →</Link></p> : <p>{text(lang, "加上 topic 后，网站会在 30 分钟内自动发现。", "After the topic is added, the hub discovers it within 30 minutes.")}</p>}</>}
              </div>}
            </form>
            <div className="callout"><div><h2>{text(lang, "公开链路", "Public paths")}</h2></div><div className="callout__links"><a href="https://github.com/topics/dsh-plugin" target="_blank" rel="noreferrer">GitHub topic ↗</a><a href={data.sources.curated.repository} target="_blank" rel="noreferrer">awesome-dsh-plugin ↗</a></div></div>
          </section>
        )}

        {page === "plugin" && selected && (
          <section className="shell page-section plugin-page">
            <div className="plugin-page__top">
              <span>PLUGIN {String(selected.order + 1).padStart(3, "0")}</span>
              <Link href={catalogHref} prefetch={false}>{text(lang, "返回目录", "Back to catalog")} →</Link>
            </div>
            <PluginDetail
              plugin={selected}
              lang={lang}
              categoryLabel={data.categories[selected.category][lang]}
              favorite={favorites.includes(selected.id)}
              copied={copied}
              related={relatedPlugins}
              previous={previousPlugin}
              next={nextPlugin}
              catalogHref={catalogHref}
              onCopy={copy}
              onFavorite={() => toggleFavorite(selected.id)}
              onShare={shareSelected}
            />
          </section>
        )}

        {page === "guide" && (
          <section className="shell page-section prose-page">
            <div className="page-heading"><div><h1>{text(lang, "从一个可检查的插件开始", "Start with an inspectable plugin")}</h1><p>{text(lang, "最短路径：模板、manifest、公开扩展点、静态体检、独立 profile 验证。", "The shortest path: template, manifest, public seams, static checks, isolated-profile verification.")}</p></div></div>
            <div className="guide-grid">
              {[
                ["01", "模板", "Template", "克隆最小骨架，先跑通加载与卸载。", "Clone a minimal skeleton and verify load/unload first."],
                ["02", "清单", "Manifest", "声明 bundle、入口、配置和客户端模块。", "Declare bundle, entrypoint, config, and client modules."],
                ["03", "边界", "Boundaries", "写清文件、网络、Shell、密钥和遥测。", "Document files, network, shell, secrets, and telemetry."],
                ["04", "验证", "Verification", "固定 dsh 版本，在独立 profile 和临时工作区测试。", "Pin dsh, then test in an isolated profile and disposable workspace."],
                ["05", "发布", "Publish", "提交许可证、锁文件、构建产物和可复现安装说明。", "Ship license, lockfile, build artifacts, and reproducible install steps."],
              ].map(([no, zhTitle, enTitle, zhBody, enBody]) => <article key={no}><b>{no}</b><h2>{lang === "zh" ? zhTitle : enTitle}</h2><p>{text(lang, zhBody, enBody)}</p></article>)}
            </div>
            {(() => {
              const example = data.plugins[0];
              const command = example ? pluginInstallCommand(example) : "npx @deepseek-ai/dsh plugin --profile web add github:owner/repository";
              return (
                <>
                  <div className="code-panel"><span>$</span><code>{command}</code><button type="button" onClick={() => copy(command, "guide")}>{copied === "guide" ? text(lang, "已复制", "Copied") : text(lang, "复制", "Copy")}</button></div>
                  <p className="fine-print">{example
                    ? text(lang, `这是已通过检查的 ${visiblePluginName(example)} 安装命令，可直接对照格式。发布前请确认包内已有可加载产物。`, `This is the inspected install command for ${visiblePluginName(example)}. Confirm the package contains loadable artifacts before publishing.`)
                    : text(lang, "命令只是格式示例。发布前请确认包内已有可加载产物，Git 安装所需的 prepare 脚本也应明确披露。", "The command is a format example. Before publishing, confirm the package contains loadable artifacts and disclose any prepare script needed by Git installs.")}</p>
                  {example && <p className="fine-print"><Link href={pluginPath(example)} prefetch={false}>{text(lang, "查看这个示例插件", "Open this example plugin")} →</Link></p>}
                </>
              );
            })()}
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span>DSH PLUGIN HUB · {data.summary.listed} LISTED · {data.summary.autoDiscovered} AUTO · 30 MIN</span>
        <span>{text(lang, "社区索引 · 与 DeepSeek AI 无隶属关系", "Community index · not affiliated with DeepSeek AI")}</span>
        <Link href="/api/plugins">JSON API</Link>
      </footer>
      {copyMessage && <div className="toast" role="status" aria-live="polite">{copyMessage}</div>}
    </div>
  );
}
