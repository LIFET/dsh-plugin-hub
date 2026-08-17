export const SCREENING_VERSION = 1;

export function classifyInspectionFailure(value) {
  const message = typeof value === "string" ? value : "";
  return /response (?:exceeded|too large)|unsafe repository path|invalid github repository|invalid json|\b409\b|git repository is empty|empty repositor|no commit found on the default branch/iu.test(message)
    ? "uninspectable"
    : "transient";
}

export function sanitizePublicScanError(value) {
  const message = typeof value === "string" ? value : "";
  if (/\b409\b|git repository is empty|empty repositor|no commit found on the default branch/iu.test(message)) {
    return "Some listed repositories are empty or have no inspectable default branch.";
  }
  if (/rate limit/iu.test(message)) {
    return "GitHub rate limit reached; the next scan will retry.";
  }
  if (/response (?:exceeded|too large)/iu.test(message)) {
    return "Some repository files exceeded the inspection size limit.";
  }
  if (/403|forbidden|unauthorized|401/iu.test(message)) {
    return "GitHub refused one or more inspection requests.";
  }
  if (/timeout|network|econnreset|enotfound|fetch failed/iu.test(message)) {
    return "A network error interrupted part of the scan.";
  }
  return "Some repositories could not be inspected in this scan.";
}

const EVIDENCE_TIER = { clear: 0, review: 1, pending: 2, blocked: 3 };

export function comparePluginsByEvidence(a, b) {
  const tierA = EVIDENCE_TIER[a?.screening?.state] ?? 4;
  const tierB = EVIDENCE_TIER[b?.screening?.state] ?? 4;
  if (tierA !== tierB) return tierA - tierB;
  const verifiedA = a?.manifest?.state === "verified" ? 1 : 0;
  const verifiedB = b?.manifest?.state === "verified" ? 1 : 0;
  if (verifiedA !== verifiedB) return verifiedB - verifiedA;
  const starsA = Number.isFinite(a?.stars) ? a.stars : -1;
  const starsB = Number.isFinite(b?.stars) ? b.stars : -1;
  if (starsA !== starsB) return starsB - starsA;
  return (a?.order ?? 0) - (b?.order ?? 0);
}

export function resolveRegistryScanLimit({ token, requested } = {}) {
  const fallback = typeof token === "string" && token.trim() ? 40 : 7;
  const parsed = Number(requested ?? fallback);
  return Number.isInteger(parsed) ? Math.min(50, Math.max(1, parsed)) : fallback;
}

export function suggestedInstallCommand(plugin, profile = "web") {
  const repo = typeof plugin?.repo === "string" ? plugin.repo : "";
  const commit = typeof plugin?.screenedCommit === "string"
    && /^[a-f\d]{40,64}$/iu.test(plugin.screenedCommit)
    ? plugin.screenedCommit.toLowerCase()
    : null;
  if (!repo) return "";
  const flag = profile === "web" ? " --profile web" : "";
  const pin = commit ? `#${commit}` : "";
  return `dsh plugin${flag} add github:${repo}${pin}`;
}

export function pluginSearchHaystack(plugin, extras = []) {
  const findings = Array.isArray(plugin?.screening?.findings) ? plugin.screening.findings : [];
  return [
    plugin?.name,
    plugin?.owner,
    plugin?.repo,
    plugin?.description?.zh,
    plugin?.description?.en,
    plugin?.manifest?.packageName,
    plugin?.license,
    plugin?.language,
    ...findings.flatMap((finding) => [finding?.label?.zh, finding?.label?.en, finding?.id]),
    ...extras,
  ].join(" ").toLowerCase();
}

export function matchesSearchQuery(haystack, query) {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return true;
  const text = String(haystack || "");
  return tokens.every((token) => text.includes(token));
}

export function withPackageRunner(command, runner = "dsh") {
  const value = typeof command === "string" ? command : "";
  if (!value) return "";
  if (runner === "npx") {
    return value.startsWith("npx ") ? value : `npx @deepseek-ai/dsh ${value.replace(/^dsh\s+/u, "")}`;
  }
  return value.replace(/^npx @deepseek-ai\/dsh\s+/u, "dsh ");
}

export function displayInstallCommand(command, profile = "web") {
  const value = typeof command === "string" ? command : "";
  if (!value) return "";
  if (profile === "web") {
    return value.includes("--profile web") ? value : value.replace(/^dsh plugin add /u, "dsh plugin --profile web add ");
  }
  return value.replace(" --profile web", "");
}

export function displayDescription(plugin, lang) {
  const raw = String(plugin?.description?.[lang] || plugin?.description?.zh || plugin?.description?.en || "");
  return raw.replace(/^\[GitHub (?:原文|description)\]\s*/iu, "").trim();
}

export function visiblePluginName(plugin) {
  const raw = String(plugin?.name || plugin?.repo?.split?.("/")?.[1] || "").trim();
  if (raw.startsWith("@") && raw.includes("/")) return raw.slice(raw.indexOf("/") + 1);
  return raw || String(plugin?.repo || "plugin");
}

export function selectFeaturedPlugins(plugins, limit = 6) {
  const eligible = [...(Array.isArray(plugins) ? plugins : [])]
    .filter((plugin) => plugin?.stars !== null && plugin?.stars !== undefined && plugin?.screening?.state !== "blocked");
  const byStars = (a, b) => (b.stars || 0) - (a.stars || 0) || comparePluginsByEvidence(a, b);
  const clear = eligible.filter((plugin) => plugin.screening?.state === "clear").sort(byStars);
  const rest = eligible.filter((plugin) => plugin.screening?.state !== "clear").sort(byStars);
  return [...clear, ...rest].slice(0, limit);
}

export function selectRelatedPlugins(plugins, current, limit = 3) {
  if (!current) return [];
  return [...(Array.isArray(plugins) ? plugins : [])]
    .filter((plugin) => plugin?.id && plugin.id !== current.id && plugin.category === current.category && plugin.screening?.state !== "blocked")
    .sort(comparePluginsByEvidence)
    .slice(0, limit);
}

export function inspectionQueuePriority(previous) {
  if (previous && previous.screening?.scope !== "source") return 0;
  if (previous) return 1;
  return 2;
}

const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const SOURCE_RULES = [
  {
    id: "permission-bypass",
    severity: "high",
    pattern: /dangerously[-_]skip[-_]permissions|--dangerously|bypassPermissions/iu,
    label: {
      zh: "发现绕过权限确认的参数或配置",
      en: "Permission-confirmation bypass signal found",
    },
  },
  {
    id: "dynamic-code",
    severity: "high",
    pattern: /\beval\s*\(|new\s+Function\s*\(|cordis_mount\b/iu,
    label: {
      zh: "发现动态代码执行入口",
      en: "Dynamic code execution signal found",
    },
  },
  {
    id: "destructive-filesystem",
    severity: "high",
    pattern: /\b(?:rmSync|rmdirSync|unlinkSync)\s*\(|\brm\s*\([^\n]{0,180}recursive\s*:\s*true/iu,
    label: {
      zh: "发现递归删除或直接删除文件的调用",
      en: "Destructive filesystem operation signal found",
    },
  },
  {
    id: "shell-execution",
    severity: "medium",
    pattern: /node:child_process|child_process|\b(?:execFile|execSync|spawnSync|spawn)\s*\(|Bun\.spawn|Deno\.Command/iu,
    label: {
      zh: "发现 Shell 或子进程调用",
      en: "Shell or subprocess execution signal found",
    },
  },
  {
    id: "network-egress",
    severity: "medium",
    pattern: /\bfetch\s*\(|\bWebSocket\s*\(|node:https?|from\s+["'](?:axios|undici|got)["']|require\s*\(\s*["'](?:axios|undici|got|https?)["']/iu,
    label: {
      zh: "发现主动网络请求能力",
      en: "Outbound network capability signal found",
    },
  },
  {
    id: "filesystem-write",
    severity: "medium",
    pattern: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|mkdir|mkdirSync)\s*\(/iu,
    label: {
      zh: "发现本地文件写入能力",
      en: "Local filesystem write capability signal found",
    },
  },
  {
    id: "credential-access",
    severity: "medium",
    pattern: /process\.env|\.env\b|api[_-]?key|access[_-]?token|authorization\b|credentials?/iu,
    label: {
      zh: "发现环境变量、密钥或凭据访问线索",
      en: "Environment, secret, or credential access signal found",
    },
  },
  {
    id: "public-listener",
    severity: "medium",
    pattern: /["']0\.0\.0\.0["']|["']::["']|\.listen\s*\(/iu,
    label: {
      zh: "发现网络监听能力，需确认监听地址与认证",
      en: "Network listener signal found; bind address and auth need review",
    },
  },
  {
    id: "html-execution",
    severity: "medium",
    pattern: /dangerouslySetInnerHTML|text\/html|image\/svg\+xml|document\.write\s*\(/iu,
    label: {
      zh: "发现 HTML 或 SVG 主动内容处理能力",
      en: "Active HTML or SVG handling signal found",
    },
  },
  {
    id: "telemetry",
    severity: "medium",
    pattern: /posthog|sentry|segment|mixpanel|amplitude|google-analytics|opentelemetry|telemetry/iu,
    label: {
      zh: "发现遥测或分析服务线索",
      en: "Telemetry or analytics signal found",
    },
  },
];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function exportPath(value) {
  if (typeof value === "string") return value;
  const record = asObject(value);
  for (const key of ["default", "import", "require", "node", "browser"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return null;
}

export function normalizeRepositoryPath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    /^[a-z][a-z\d+.-]*:/iu.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function repositoryRootFiles(value) {
  if (!value || typeof value !== "object" || value.truncated || !Array.isArray(value.tree)) {
    throw new Error("GitHub returned an incomplete repository root tree");
  }
  return [...new Set(value.tree.flatMap((entry) => (
    entry
      && entry.type === "blob"
      && typeof entry.path === "string"
      && !entry.path.includes("/")
      ? [entry.path]
      : []
  )))];
}

export function manifestSummary(pkg, branch) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return {
      state: "missing",
      branch,
      kinds: [],
      packageName: null,
      version: null,
      lifecycleScripts: [],
      runtimeDependencies: 0,
      declaredPaths: [],
      invalidDeclaredPaths: [],
    };
  }

  const dsh = asObject(pkg.dsh);
  const kinds = ["bundle", "plugin", "profile", "client"].filter(
    (key) => dsh[key] !== undefined,
  );
  const scripts = asObject(pkg.scripts);
  const lifecycleScripts = LIFECYCLE_SCRIPTS.filter(
    (key) => typeof scripts[key] === "string" && scripts[key].trim(),
  );
  const exportsField = asObject(pkg.exports);
  const bundle = asObject(dsh.bundle);
  const candidates = [
    bundle.patch,
    pkg.main,
    exportPath(exportsField["."]),
    dsh.client === undefined ? null : exportPath(exportsField["./client"]),
  ].filter((value) => typeof value === "string");
  const declaredPaths = [];
  const invalidDeclaredPaths = [];
  for (const value of candidates) {
    const normalized = normalizeRepositoryPath(value);
    if (normalized) declaredPaths.push(normalized);
    else invalidDeclaredPaths.push(value);
  }

  return {
    state: kinds.length ? "verified" : "package-only",
    branch,
    kinds,
    packageName: typeof pkg.name === "string" ? pkg.name : null,
    version: typeof pkg.version === "string" ? pkg.version : null,
    lifecycleScripts,
    runtimeDependencies: Object.keys(asObject(pkg.dependencies)).length,
    declaredPaths: [...new Set(declaredPaths)].slice(0, 6),
    invalidDeclaredPaths: [...new Set(invalidDeclaredPaths)].slice(0, 6),
  };
}

function makeFinding(id, severity, zh, en, files = []) {
  return {
    id,
    severity,
    label: { zh, en },
    files: [...new Set(files)].slice(0, 8),
  };
}

export function baselineScreening(meta, manifest, files = [], checkedAt = new Date().toISOString()) {
  const normalizedFiles = files.map((file) => String(file));
  const lowerFiles = new Set(normalizedFiles.map((file) => file.toLowerCase()));
  const findings = [];

  if (meta?.archived) {
    findings.push(makeFinding("archived", "high", "仓库已经归档", "Repository is archived"));
  }
  if (manifest.state !== "verified") {
    findings.push(makeFinding("manifest-missing", "high", "未识别到有效的 dsh manifest", "No valid dsh manifest found"));
  }
  if (manifest.invalidDeclaredPaths?.length) {
    findings.push(makeFinding(
      "unsafe-declared-path",
      "high",
      "manifest 含有越界或非仓库相对路径",
      "Manifest contains unsafe or non-relative paths",
      manifest.invalidDeclaredPaths,
    ));
  }
  if (!meta?.license?.spdx_id || meta.license.spdx_id === "NOASSERTION") {
    findings.push(makeFinding("license-missing", "medium", "仓库未声明可识别许可证", "No recognized repository license"));
  }
  if (manifest.lifecycleScripts?.length) {
    findings.push(makeFinding(
      "lifecycle-script",
      "medium",
      `发现安装生命周期脚本：${manifest.lifecycleScripts.join(", ")}`,
      `Install lifecycle scripts found: ${manifest.lifecycleScripts.join(", ")}`,
      ["package.json"],
    ));
  }

  const hasReadme = normalizedFiles.some((file) => /^readme(?:\.[^/]+)?$/iu.test(file));
  const hasLockfile = [...lowerFiles].some((file) => LOCKFILES.has(file));
  if (normalizedFiles.length && !hasReadme) {
    findings.push(makeFinding("readme-missing", "medium", "仓库根目录未发现 README", "No root README found"));
  }
  if (normalizedFiles.length && !hasLockfile) {
    findings.push(makeFinding("lockfile-missing", "info", "仓库根目录未发现依赖锁文件", "No root dependency lockfile found"));
  }

  return {
    version: SCREENING_VERSION,
    scope: "manifest",
    state: findings.some((item) => item.severity === "high") ? "blocked" : "pending",
    risk: findings.some((item) => item.severity === "high") ? "high" : "unknown",
    checkedAt,
    findings,
    filesInspected: ["package.json"],
    checks: {
      manifest: manifest.state === "verified",
      license: Boolean(meta?.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION"),
      readme: hasReadme,
      lockfile: hasLockfile,
      source: false,
      securityDisclosure: false,
    },
  };
}

export function screenRepository({ meta, manifest, files, sourceFiles, readme, checkedAt = new Date().toISOString() }) {
  const baseline = baselineScreening(meta, manifest, files, checkedAt);
  const findings = [...baseline.findings];
  const inspected = [];

  for (const source of sourceFiles || []) {
    if (!source || typeof source.path !== "string" || typeof source.text !== "string") continue;
    inspected.push(source.path);
    for (const rule of SOURCE_RULES) {
      if (!rule.pattern.test(source.text)) continue;
      const existing = findings.find((item) => item.id === rule.id);
      if (existing) existing.files = [...new Set([...existing.files, source.path])].slice(0, 8);
      else findings.push(makeFinding(rule.id, rule.severity, rule.label.zh, rule.label.en, [source.path]));
    }
  }

  if (!inspected.length) {
    findings.push(makeFinding("source-unavailable", "medium", "未能读取声明入口或候选源码", "Declared entrypoint or candidate source was unavailable"));
  }

  const high = findings.some((item) => item.severity === "high");
  const medium = findings.some((item) => item.severity === "medium");
  const readmeText = typeof readme === "string" ? readme.slice(0, 120_000) : "";
  const securityDisclosure = /security|安全|权限|permission|privacy|隐私|telemetry|遥测/iu.test(readmeText);

  return {
    ...baseline,
    scope: "source",
    state: high ? "blocked" : medium ? "review" : "clear",
    risk: high ? "high" : medium ? "medium" : "low",
    findings,
    filesInspected: ["package.json", ...inspected].slice(0, 12),
    checks: {
      ...baseline.checks,
      source: inspected.length > 0,
      securityDisclosure,
    },
  };
}

export function markInspectionUnavailable(previous, { kind, checkedAt, manifest = null }) {
  const rejected = kind === "rejected";
  const label = rejected
    ? {
        zh: "当前仓库检查未通过，安装命令已撤回",
        en: "The current repository inspection failed; the install command was withdrawn",
      }
    : {
        zh: "当前仓库无法完成检查，安装命令已暂时撤回",
        en: "The current repository inspection could not complete; the install command was withdrawn",
      };
  const currentManifest = manifest || manifestSummary(
    null,
    previous.defaultBranch || previous.manifest?.branch || null,
  );
  const screening = {
    version: SCREENING_VERSION,
    scope: "manifest",
    state: rejected ? "blocked" : "review",
    risk: rejected ? "high" : "unknown",
    checkedAt,
    findings: [makeFinding(
      rejected ? "current-inspection-rejected" : "current-inspection-error",
      rejected ? "high" : "medium",
      label.zh,
      label.en,
      ["package.json"],
    )],
    filesInspected: ["package.json"],
    checks: {
      manifest: false,
      license: false,
      readme: false,
      lockfile: false,
      source: false,
      securityDisclosure: false,
    },
  };

  return {
    ...previous,
    manifest: currentManifest,
    screenedCommit: null,
    installCommand: null,
    discovery: {
      ...previous.discovery,
      lastSeenAt: checkedAt,
    },
    screening,
    attention: {
      level: rejected ? "caution" : "review",
      reasons: [label.zh],
    },
  };
}

export function applyScreeningPolicy(plugin) {
  if (!plugin || typeof plugin !== "object" || !plugin.screening) return plugin;
  const findings = (plugin.screening.findings || []).map((finding) => (
    finding?.id === "lockfile-missing" && finding.severity !== "info"
      ? { ...finding, severity: "info" }
      : finding
  ));
  if (plugin.screening.scope !== "source") {
    return findings === plugin.screening.findings ? plugin : { ...plugin, screening: { ...plugin.screening, findings } };
  }
  const high = findings.some((finding) => finding?.severity === "high");
  const medium = findings.some((finding) => finding?.severity === "medium");
  const state = high ? "blocked" : medium ? "review" : "clear";
  const risk = high ? "high" : medium ? "medium" : "low";
  if (
    state === plugin.screening.state
    && risk === plugin.screening.risk
    && findings.every((finding, index) => finding?.severity === plugin.screening.findings?.[index]?.severity)
  ) {
    return plugin;
  }
  return {
    ...plugin,
    screening: { ...plugin.screening, findings, state, risk },
    attention: {
      level: state === "blocked" ? "caution" : state === "clear" ? "clear" : "review",
      reasons: findings
        .filter((finding) => finding?.severity && finding.severity !== "info")
        .map((finding) => finding.label?.zh)
        .filter(Boolean),
    },
  };
}

export function sanitizeRegistryInstallEvidence(registry) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.plugins)) return registry;
  const plugins = registry.plugins.map((plugin) => {
    if (!plugin || typeof plugin !== "object") return plugin;
    const normalized = applyScreeningPolicy(plugin);
    const commit = typeof normalized.screenedCommit === "string"
      && /^[a-f\d]{40,64}$/iu.test(normalized.screenedCommit)
      ? normalized.screenedCommit.toLowerCase()
      : null;
    if (!commit) return { ...normalized, screenedCommit: null, installCommand: null };
    const repo = typeof normalized.repo === "string" && /^[a-z\d_.-]+\/[a-z\d_.-]+$/iu.test(normalized.repo)
      ? normalized.repo
      : null;
    const allowed = normalized.manifest?.state === "verified" && normalized.screening?.state === "clear";
    const expected = repo ? `dsh plugin --profile web add github:${repo}#${commit}` : null;
    return {
      ...normalized,
      screenedCommit: commit,
      installCommand: allowed ? expected : null,
    };
  });
  const next = { ...registry, plugins };
  if (next.summary && typeof next.summary === "object") {
    next.summary = {
      ...next.summary,
      screeningClear: plugins.filter((plugin) => plugin?.screening?.state === "clear").length,
      screeningReview: plugins.filter((plugin) => ["review", "pending"].includes(plugin?.screening?.state)).length,
      screeningBlocked: plugins.filter((plugin) => plugin?.screening?.state === "blocked").length,
    };
  }
  return next;
}

const CATEGORY_RULES = {
  ui: /\bui\b|sidebar|panel|theme|layout|canvas|visual|frontend|界面|侧栏|主题|面板/iu,
  session: /session|memory|history|checkpoint|rewind|share|export|import|会话|记忆|历史|回退/iu,
  workflow: /workflow|agent|subagent|schedule|cron|automation|monitor|任务|代理|工作流|定时|监控/iu,
  notify: /notify|notification|webhook|slack|telegram|feishu|lark|discord|提醒|通知|飞书/iu,
  dev: /sandbox|runtime|model|provider|debug|health|inspect|security|开发|沙箱|模型|调试|安全/iu,
  fun: /game|pet|sticker|emoji|chess|music|fun|游戏|宠物|贴纸|表情|音乐/iu,
  tools: /tool|ocr|vision|file|database|browser|search|document|工具|视觉|文件|数据库|浏览器|搜索|文档/iu,
};

export function categoryFromText(value) {
  const text = String(value || "");
  for (const category of ["ui", "session", "workflow", "notify", "dev", "fun", "tools"]) {
    if (CATEGORY_RULES[category].test(text)) return category;
  }
  return "tools";
}
