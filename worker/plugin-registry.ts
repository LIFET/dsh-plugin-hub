import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import bundledRegistryJson from "../data/plugins.generated.json";
import type {
  CategoryId,
  PluginManifest,
  PluginRecord,
  PluginRegistryData,
  PluginScreening,
} from "../lib/plugin-data";
import { readResponseTextLimited } from "../lib/limited-response.mjs";
import {
  categoryFromText,
  classifyInspectionFailure,
  markInspectionUnavailable,
  manifestSummary,
  normalizeRepositoryPath,
  repositoryRootFiles,
  resolveRegistryScanLimit,
  sanitizePublicScanError,
  sanitizeRegistryInstallEvidence,
  screenRepository,
} from "../lib/plugin-screening.mjs";

const STORE_FILENAME = "plugin-registry-store.json";
const LOCK_FILENAME = "plugin-registry-sync.lock";
const LOCK_STALE_MS = 25 * 60 * 1_000;
const MAX_SEARCH_PAGE = 10;
const RESCAN_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_JSON_BYTES = 6_000_000;
const MAX_COMMIT_JSON_BYTES = 300_000;
const MAX_TEXT_BYTES = 140_000;

export interface PluginRegistryEnv {
  GITHUB_TOKEN?: string;
  REGISTRY_DATA_DIR?: string;
  REGISTRY_SCAN_LIMIT?: string | number;
}

interface RuntimeStore {
  registry: PluginRegistryData;
  state: SyncState;
}

export type RegistrySource = "node-file" | "bundled-fallback";

export class RegistrySyncInProgressError extends Error {
  constructor() {
    super("Plugin registry sync is already running");
    this.name = "RegistrySyncInProgressError";
  }
}

interface GithubRepository {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  subscribers_count?: number;
  pushed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  language: string | null;
  owner?: { login?: string };
  license?: { spdx_id?: string | null } | null;
  topics?: string[];
}

interface GithubSearchResponse {
  total_count: number;
  items: GithubRepository[];
}

interface GithubCommitResponse {
  sha: string;
}

interface SeenCandidate {
  pushedAt: string | null;
  checkedAt: string;
  outcome: "listed" | "rejected" | "blocked" | "error" | "uninspectable";
  retryAfter?: string;
}

interface SyncState {
  cursorPage: number;
  seen: Record<string, SeenCandidate>;
}

function dataDirectory(env: PluginRegistryEnv) {
  const configured = env.REGISTRY_DATA_DIR?.trim() || process.env.REGISTRY_DATA_DIR?.trim();
  return resolve(/* turbopackIgnore: true */ configured || ".data");
}

function storePath(env: PluginRegistryEnv) {
  return resolve(/* turbopackIgnore: true */ dataDirectory(env), STORE_FILENAME);
}

let runtimeStoreCache: { path: string; mtimeMs: number; size: number; value: RuntimeStore } | null = null;

async function readRuntimeStore(env: PluginRegistryEnv): Promise<RuntimeStore | null> {
  try {
    const path = storePath(env);
    const details = await stat(path);
    if (runtimeStoreCache?.path === path
      && runtimeStoreCache.mtimeMs === details.mtimeMs
      && runtimeStoreCache.size === details.size) {
      return runtimeStoreCache.value;
    }
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<RuntimeStore>;
    if (!parsed.registry || !parsed.state || typeof parsed.state.seen !== "object") {
      throw new Error("Registry store has an invalid shape");
    }
    runtimeStoreCache = { path, mtimeMs: details.mtimeMs, size: details.size, value: parsed as RuntimeStore };
    return runtimeStoreCache.value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(JSON.stringify({
      event: "registry.store.read.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

async function writeRuntimeStore(env: PluginRegistryEnv, value: RuntimeStore) {
  const directory = dataDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = storePath(env);
  const temporary = resolve(/* turbopackIgnore: true */ directory, `.${STORE_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
    runtimeStoreCache = null;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function acquireSyncLock(env: PluginRegistryEnv) {
  const directory = dataDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = resolve(/* turbopackIgnore: true */ directory, LOCK_FILENAME);
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
          const expected = Buffer.from(token);
          const actual = Buffer.from(current.token || "");
          if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
            await unlink(lockPath);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const details = await stat(lockPath).catch(() => null);
      if (!details || Date.now() - details.mtimeMs <= LOCK_STALE_MS) {
        throw new RegistrySyncInProgressError();
      }
      const stalePath = `${lockPath}.stale.${randomUUID()}`;
      await rename(lockPath, stalePath).catch((renameError) => {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      });
      await unlink(stalePath).catch(() => undefined);
    }
  }

  throw new RegistrySyncInProgressError();
}

function bundledRegistry(): PluginRegistryData {
  return sanitizeRegistryInstallEvidence(
    JSON.parse(JSON.stringify(bundledRegistryJson)),
  ) as PluginRegistryData;
}

function githubHeaders(env: PluginRegistryEnv) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "dsh-plugin-hub-self-hosted-sync",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_TOKEN?.trim() ? { Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}` } : {}),
  };
}

function validateRepoName(value: string) {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/iu.test(value)) {
    throw new Error(`Invalid GitHub repository name: ${value}`);
  }
  return value;
}

function repositoryFromUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("请输入完整的 GitHub 仓库地址");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error("只支持 https://github.com 上的公开仓库");
  }
  const parts = parsed.pathname.replace(/\.git$/u, "").split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("仓库地址应为 https://github.com/owner/repository");
  return validateRepoName(`${parts[0]}/${parts[1]}`);
}

async function fetchLimited(url: string, init: RequestInit, maxBytes: number) {
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const suffix = remaining === "0" ? " (GitHub rate limit reached)" : "";
    throw new Error(`${response.status} ${response.statusText}: ${url}${suffix}`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error(`Response too large (${length} bytes): ${url}`);
  try {
    return await readResponseTextLimited(response, maxBytes);
  } catch (error) {
    if (error instanceof RangeError) throw new Error(`Response exceeded ${maxBytes} bytes: ${url}`);
    throw error;
  }
}

async function fetchJson<T>(url: string, env: PluginRegistryEnv, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const text = await fetchLimited(url, { headers: githubHeaders(env) }, maxBytes);
  if (text === null) throw new Error(`404 Not Found: ${url}`);
  return JSON.parse(text) as T;
}

async function fetchRaw(repo: string, revision: string, filePath: string) {
  validateRepoName(repo);
  const safePath = normalizeRepositoryPath(filePath);
  if (!safePath) throw new Error(`Unsafe repository path: ${filePath}`);
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(revision)}/${encodedPath}`;
  return fetchLimited(url, { headers: { Accept: "text/plain" } }, MAX_TEXT_BYTES);
}

export async function preflightPluginRepository(value: string, env: PluginRegistryEnv) {
  const repo = repositoryFromUrl(value.trim());
  const meta = await fetchJson<GithubRepository>(`https://api.github.com/repos/${repo}`, env, MAX_COMMIT_JSON_BYTES);
  const packageText = await fetchRaw(repo, meta.default_branch, "package.json");
  let manifest: PluginManifest = manifestSummary(null, meta.default_branch);
  if (packageText !== null) {
    try {
      manifest = manifestSummary(JSON.parse(packageText), meta.default_branch);
    } catch {
      manifest = { ...manifest, state: "invalid" };
    }
  }
  const topic = Array.isArray(meta.topics) && meta.topics.includes("dsh-plugin");
  return {
    repo,
    url: `https://github.com/${repo}`,
    topic,
    manifest: manifest.state,
    eligible: topic && manifest.state === "verified",
  };
}

async function resolveCommitSha(repo: string, branch: string, env: PluginRegistryEnv) {
  validateRepoName(repo);
  const commit = await fetchJson<GithubCommitResponse>(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    env,
    MAX_COMMIT_JSON_BYTES,
  );
  if (!/^[a-f\d]{40,64}$/iu.test(commit.sha)) {
    throw new Error(`GitHub returned an invalid commit id for ${repo}`);
  }
  return commit.sha.toLowerCase();
}

function metadataFromPlugin(plugin: PluginRecord): GithubRepository {
  return {
    full_name: plugin.repo,
    name: plugin.repo.split("/")[1] || plugin.name,
    description: plugin.description.en || plugin.description.zh || null,
    html_url: plugin.url,
    homepage: plugin.homepage,
    default_branch: plugin.defaultBranch || plugin.manifest.branch || "main",
    fork: false,
    archived: plugin.archived,
    stargazers_count: plugin.stars || 0,
    forks_count: plugin.forks || 0,
    open_issues_count: plugin.openIssues || 0,
    watchers_count: plugin.watchers || 0,
    pushed_at: plugin.pushedAt,
    updated_at: plugin.updatedAt,
    created_at: plugin.createdAt,
    language: plugin.language,
    owner: { login: plugin.owner },
    license: plugin.license ? { spdx_id: plugin.license } : null,
  };
}

function selectSourcePaths(manifest: PluginManifest) {
  const declared = manifest.declaredPaths
    .filter((item) => !/\.(?:d\.ts|map)$/iu.test(item))
    .sort((a, b) => {
      const aCode = /\.[cm]?[jt]sx?$/iu.test(a) ? 0 : 1;
      const bCode = /\.[cm]?[jt]sx?$/iu.test(b) ? 0 : 1;
      return aCode - bCode;
    });
  const fallbacks = ["src/index.ts", "dsh/index.js", "index.ts", "index.js", "lib/index.js"];
  return [...new Set([...declared, ...fallbacks])].slice(0, 3);
}

async function inspectRepository(meta: GithubRepository, env: PluginRegistryEnv) {
  const repo = validateRepoName(meta.full_name);
  const branch = meta.default_branch || "main";
  const commitSha = await resolveCommitSha(repo, branch, env);
  const [packageText, rootTree] = await Promise.all([
    fetchRaw(repo, commitSha, "package.json"),
    fetchJson<unknown>(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(commitSha)}`,
      env,
      MAX_JSON_BYTES,
    ),
  ]);
  const rootFiles = repositoryRootFiles(rootTree);
  if (!packageText) return { outcome: "rejected" as const, reason: "package.json missing" };

  let pkg: unknown;
  try {
    pkg = JSON.parse(packageText);
  } catch {
    return { outcome: "rejected" as const, reason: "package.json invalid" };
  }
  const manifest = manifestSummary(pkg, branch) as PluginManifest;
  if (manifest.state !== "verified") {
    return { outcome: "rejected" as const, reason: "dsh manifest missing", manifest };
  }

  const readmePath = rootFiles.find((filePath) => /^readme(?:\.[^/]+)?$/iu.test(filePath)) || null;
  const sourcePaths = selectSourcePaths(manifest);
  const [readme, ...sourceTexts] = await Promise.all([
    readmePath ? fetchRaw(repo, commitSha, readmePath) : Promise.resolve(null),
    ...sourcePaths.map((item) => fetchRaw(repo, commitSha, item)),
  ]);
  const sourceFiles = sourcePaths.flatMap((filePath, index) => {
    const text = sourceTexts[index];
    return typeof text === "string" ? [{ path: filePath, text }] : [];
  });
  const screening = screenRepository({
    meta,
    manifest,
    files: rootFiles,
    sourceFiles,
    readme,
  }) as PluginScreening;
  return {
    outcome: screening.state === "blocked" ? "blocked" as const : "listed" as const,
    commitSha,
    manifest,
    screening,
    readme,
  };
}

function attentionFromScreening(screening: PluginScreening) {
  return {
    level: screening.state === "blocked" ? "caution" as const : screening.state === "clear" ? "clear" as const : "review" as const,
    reasons: screening.findings.map((finding) => finding.label.zh),
  };
}

function maintenanceState(meta: GithubRepository) {
  if (meta.archived) return "archived" as const;
  const pushed = meta.pushed_at ? Date.parse(meta.pushed_at) : Number.NaN;
  if (!Number.isFinite(pushed)) return "unknown" as const;
  const days = Math.max(0, Math.floor((Date.now() - pushed) / 86_400_000));
  if (days <= 30) return "active" as const;
  if (days <= 180) return "warm" as const;
  return "quiet" as const;
}

function recordFromInspection(
  meta: GithubRepository,
  commitSha: string,
  manifest: PluginManifest,
  screening: PluginScreening,
  previous: PluginRecord | undefined,
  now: string,
) {
  const curated = previous?.curated === true;
  const [fallbackOwner, fallbackName] = meta.full_name.split("/");
  const description = normalizeDescription(meta.description || manifest.packageName || meta.name);
  const installAllowed = screening.state === "clear";
  const firstSeenAt = previous?.discovery?.firstSeenAt || previous?.added || now.slice(0, 10);
  const category = previous?.category || categoryFromText(`${meta.name} ${description}`) as CategoryId;
  return {
    id: meta.full_name.toLowerCase(),
    order: previous?.order ?? Number.MAX_SAFE_INTEGER,
    name: previous?.name || manifest.packageName || fallbackName,
    owner: previous?.owner || meta.owner?.login || fallbackOwner,
    repo: meta.full_name,
    url: `https://github.com/${meta.full_name}`,
    category,
    description: previous?.description || description,
    added: previous?.added || now.slice(0, 10),
    curated,
    topic: true,
    stars: meta.stargazers_count ?? previous?.stars ?? null,
    forks: meta.forks_count ?? previous?.forks ?? null,
    openIssues: meta.open_issues_count ?? previous?.openIssues ?? null,
    watchers: meta.subscribers_count ?? meta.watchers_count ?? previous?.watchers ?? null,
    pushedAt: meta.pushed_at ?? previous?.pushedAt ?? null,
    updatedAt: meta.updated_at ?? previous?.updatedAt ?? null,
    createdAt: meta.created_at ?? previous?.createdAt ?? null,
    license: meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION" ? meta.license.spdx_id : null,
    language: meta.language ?? previous?.language ?? null,
    homepage: meta.homepage || previous?.homepage || null,
    archived: Boolean(meta.archived),
    defaultBranch: meta.default_branch || manifest.branch || null,
    maintenance: maintenanceState(meta),
    manifest,
    screenedCommit: commitSha,
    installCommand: installAllowed ? `dsh plugin --profile web add github:${meta.full_name}#${commitSha}` : null,
    discovery: {
      source: curated ? "curated" as const : "topic" as const,
      firstSeenAt,
      lastSeenAt: now,
    },
    screening,
    attention: attentionFromScreening(screening),
  } satisfies PluginRecord;
}

async function searchTopicPage(page: number, env: PluginRegistryEnv) {
  const query = new URLSearchParams({
    q: "topic:dsh-plugin",
    sort: "updated",
    order: "desc",
    per_page: "100",
    page: String(page),
  });
  return fetchJson<GithubSearchResponse>(`https://api.github.com/search/repositories?${query}`, env);
}

function shouldRescan(plugin: PluginRecord, state: SyncState) {
  const retryAfter = Date.parse(state.seen[plugin.id]?.retryAfter || "0");
  if (Number.isFinite(retryAfter) && retryAfter > Date.now()) return false;
  if (plugin.screening?.scope !== "source") return true;
  const seen = state.seen[plugin.id];
  const checked = Date.parse(seen?.checkedAt || plugin.screening.checkedAt || "0");
  return !Number.isFinite(checked) || Date.now() - checked >= RESCAN_AFTER_MS;
}

function candidateIsDeferred(meta: GithubRepository, state: SyncState) {
  const seen = state.seen[meta.full_name.toLowerCase()];
  if (!seen) return false;
  const retryAfter = Date.parse(seen.retryAfter || "0");
  if (Number.isFinite(retryAfter) && retryAfter > Date.now()) return true;
  if (!["rejected", "blocked"].includes(seen.outcome)) return false;
  const checked = Date.parse(seen.checkedAt);
  return seen.pushedAt === meta.pushed_at && Number.isFinite(checked) && Date.now() - checked < RESCAN_AFTER_MS;
}

function retryAfter(now: string, milliseconds: number) {
  return new Date(Date.parse(now) + milliseconds).toISOString();
}

function inspectionFailurePolicy(message: string, now: string) {
  return classifyInspectionFailure(message) === "uninspectable"
    ? { outcome: "uninspectable" as const, retryAfter: retryAfter(now, RESCAN_AFTER_MS), degraded: false }
    : { outcome: "error" as const, retryAfter: retryAfter(now, 6 * 60 * 60 * 1_000), degraded: true };
}

function normalizeDescription(value: string) {
  const clean = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/gu, " ").trim().slice(0, 240);
  const fallback = clean || "No repository description provided.";
  return /[\u3400-\u9fff]/u.test(fallback)
    ? { zh: fallback, en: `[GitHub description] ${fallback}`.slice(0, 280) }
    : { zh: `[GitHub 原文] ${fallback}`.slice(0, 280), en: fallback };
}

function scanLimit(env: PluginRegistryEnv) {
  return resolveRegistryScanLimit({
    token: env.GITHUB_TOKEN,
    requested: env.REGISTRY_SCAN_LIMIT,
  });
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const result = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

function compactState(state: SyncState) {
  const entries = Object.entries(state.seen)
    .sort((a, b) => Date.parse(b[1].checkedAt) - Date.parse(a[1].checkedAt))
    .slice(0, 1_500);
  return { ...state, seen: Object.fromEntries(entries) };
}

function summarize(registry: PluginRegistryData) {
  const plugins = registry.plugins;
  registry.summary = {
    curated: plugins.filter((plugin) => plugin.curated).length,
    listed: plugins.length,
    autoDiscovered: plugins.filter((plugin) => !plugin.curated).length,
    topicTotal: registry.sources.topic.total,
    metadataMatches: plugins.filter((plugin) => plugin.topic).length,
    manifestMatches: plugins.filter((plugin) => plugin.manifest.state === "verified").length,
    screeningClear: plugins.filter((plugin) => plugin.screening.state === "clear").length,
    screeningReview: plugins.filter((plugin) => ["review", "pending"].includes(plugin.screening.state)).length,
    screeningBlocked: plugins.filter((plugin) => plugin.screening.state === "blocked").length,
    owners: new Set(plugins.map((plugin) => plugin.owner.toLowerCase())).size,
    stars: plugins.reduce((sum, plugin) => sum + (plugin.stars || 0), 0),
  };
  registry.sources.topic.matched = registry.summary.metadataMatches;
}

export async function readPluginRegistryWithSource(env: PluginRegistryEnv): Promise<{
  registry: PluginRegistryData;
  source: RegistrySource;
}> {
  const stored = await readRuntimeStore(env);
  if (!stored) return { registry: bundledRegistry(), source: "bundled-fallback" };
  return {
    registry: sanitizeRegistryInstallEvidence(stored.registry) as PluginRegistryData,
    source: "node-file",
  };
}

export async function readPluginRegistry(env: PluginRegistryEnv): Promise<PluginRegistryData> {
  return (await readPluginRegistryWithSource(env)).registry;
}

async function syncPluginRegistryUnlocked(env: PluginRegistryEnv) {

  const now = new Date().toISOString();
  const stored = await readRuntimeStore(env);
  const registry = stored
    ? sanitizeRegistryInstallEvidence(stored.registry) as PluginRegistryData
    : bundledRegistry();
  const state: SyncState = stored?.state || { cursorPage: 2, seen: {} };
  const errors: string[] = [];
  let pageOne: GithubSearchResponse;
  try {
    pageOne = await searchTopicPage(1, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    registry.automation = { ...registry.automation, state: "degraded", lastRunAt: now, error: sanitizePublicScanError(message) };
    await writeRuntimeStore(env, { registry, state });
    console.error(JSON.stringify({ event: "registry.sync.error", stage: "discovery", error: message }));
    return registry;
  }

  let rotatingItems: GithubRepository[] = [];
  const rotatingPage = Math.max(2, Math.min(MAX_SEARCH_PAGE, state.cursorPage || 2));
  try {
    const rotating = await searchTopicPage(rotatingPage, env);
    rotatingItems = rotating.items || [];
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  state.cursorPage = rotatingPage >= MAX_SEARCH_PAGE ? 2 : rotatingPage + 1;

  const discovered = new Map<string, GithubRepository>();
  for (const item of [...(pageOne.items || []), ...rotatingItems]) {
    if (!item?.full_name) continue;
    try {
      discovered.set(validateRepoName(item.full_name).toLowerCase(), item);
    } catch {
      // GitHub-owned metadata that does not fit an owner/repository pair is ignored.
    }
  }

  const previousById = new Map(registry.plugins.map((plugin) => [plugin.id, plugin]));
  const newOrChanged = [...discovered.entries()]
    .filter(([id, meta]) => {
      const previous = previousById.get(id);
      if (candidateIsDeferred(meta, state)) return false;
      return !previous || previous.pushedAt !== meta.pushed_at || shouldRescan(previous, state);
    })
    .map(([, meta]) => meta);
  const staleExisting = registry.plugins
    .filter((plugin) => shouldRescan(plugin, state) && !discovered.has(plugin.id))
    .map(metadataFromPlugin);
  const candidates = [...newOrChanged, ...staleExisting].slice(0, scanLimit(env));
  const discoveredThisRun = [...discovered.keys()].filter((id) => !previousById.has(id)).length;

  const results = await mapLimit(candidates, 2, async (meta) => {
    try {
      return { meta, inspection: await inspectRepository(meta, env) };
    } catch (error) {
      return { meta, error: error instanceof Error ? error.message : String(error) };
    }
  });

  let admittedThisRun = 0;
  for (const result of results) {
    const id = result.meta.full_name.toLowerCase();
    const previous = previousById.get(id);
    if ("error" in result) {
      const errorMessage = result.error || "Unknown inspection error";
      const policy = inspectionFailurePolicy(errorMessage, now);
      state.seen[id] = {
        pushedAt: result.meta.pushed_at,
        checkedAt: now,
        outcome: policy.outcome,
        retryAfter: policy.retryAfter,
      };
      if (policy.degraded) errors.push(`${result.meta.full_name}: ${errorMessage}`);
      if (previous) {
        previousById.set(id, markInspectionUnavailable(previous as unknown as Record<string, unknown>, {
          kind: "error",
          checkedAt: now,
        }) as unknown as PluginRecord);
      }
      continue;
    }
    const inspection = result.inspection;
    state.seen[id] = { pushedAt: result.meta.pushed_at, checkedAt: now, outcome: inspection.outcome };
    if (inspection.outcome === "listed") {
      const record = recordFromInspection(result.meta, inspection.commitSha, inspection.manifest, inspection.screening, previous, now);
      previousById.set(id, record);
      if (!previous) admittedThisRun += 1;
      continue;
    }
    if (inspection.outcome === "blocked") {
      if (previous?.curated) {
        previousById.set(id, recordFromInspection(result.meta, inspection.commitSha, inspection.manifest, inspection.screening, previous, now));
      } else {
        previousById.delete(id);
      }
      continue;
    }
    if (previous) {
      previousById.set(id, markInspectionUnavailable(previous as unknown as Record<string, unknown>, {
        kind: "rejected",
        checkedAt: now,
        manifest: "manifest" in inspection ? inspection.manifest : null,
      }) as unknown as PluginRecord);
    }
  }

  const plugins = [...previousById.values()].sort((a, b) => {
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    if (a.curated) return a.order - b.order;
    return b.discovery.firstSeenAt.localeCompare(a.discovery.firstSeenAt) || a.name.localeCompare(b.name);
  });
  plugins.forEach((plugin, index) => { plugin.order = index; });
  registry.plugins = plugins;
  registry.schemaVersion = 2;
  registry.generatedAt = now;
  registry.sources.topic = {
    ...registry.sources.topic,
    state: errors.length ? "partial" : "live",
    total: pageOne.total_count || registry.sources.topic.total,
    scanned: Object.keys(state.seen).length,
    error: errors.length ? sanitizePublicScanError(errors[0]) : null,
  };
  registry.automation = {
    enabled: true,
    schedule: "*/30 * * * *",
    state: errors.length ? "degraded" : "live",
    scanVersion: 1,
    lastRunAt: now,
    lastSuccessfulRunAt: errors.length ? registry.automation?.lastSuccessfulRunAt || null : now,
    checkedThisRun: candidates.length,
    discoveredThisRun,
    admittedThisRun,
    rejectedTotal: Object.values(state.seen).filter((item) => ["rejected", "blocked"].includes(item.outcome)).length,
    error: errors.length ? sanitizePublicScanError(errors[0]) : null,
  };
  summarize(registry);

  await writeRuntimeStore(env, { registry, state: compactState(state) });
  console.log(JSON.stringify({
    event: "registry.sync.complete",
    checked: candidates.length,
    discovered: discoveredThisRun,
    admitted: admittedThisRun,
    listed: registry.summary.listed,
    errors: errors.length,
  }));
  return registry;
}

export async function syncPluginRegistry(env: PluginRegistryEnv) {
  const release = await acquireSyncLock(env);
  try {
    return await syncPluginRegistryUnlocked(env);
  } finally {
    await release();
  }
}

export function pluginRegistryResponse(registry: PluginRegistryData, source: RegistrySource) {
  return Response.json(registry, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      "X-Registry-Source": source,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
