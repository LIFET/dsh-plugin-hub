import rawData from "@/data/plugins.generated.json";
import { sanitizeRegistryInstallEvidence } from "@/lib/plugin-screening.mjs";

export type Language = "zh" | "en";
export type CategoryId =
  | "ui"
  | "theme"
  | "session"
  | "memory"
  | "tools"
  | "workflow"
  | "notify"
  | "model"
  | "dev"
  | "fun";

export interface PluginManifest {
  state: "verified" | "package-only" | "missing" | "invalid" | "error";
  branch: string | null;
  kinds: string[];
  packageName: string | null;
  version: string | null;
  lifecycleScripts: string[];
  runtimeDependencies: number;
  declaredPaths: string[];
  invalidDeclaredPaths: string[];
}

export interface PluginScreening {
  version: number;
  scope: "manifest" | "source";
  state: "clear" | "review" | "blocked" | "pending";
  risk: "low" | "medium" | "high" | "unknown";
  checkedAt: string;
  findings: Array<{
    id: string;
    severity: "info" | "medium" | "high";
    label: Record<Language, string>;
    files: string[];
  }>;
  filesInspected: string[];
  checks: {
    manifest: boolean;
    license: boolean;
    readme: boolean;
    lockfile: boolean;
    source: boolean;
    securityDisclosure: boolean;
  };
}

export interface PluginRecord {
  id: string;
  order: number;
  name: string;
  owner: string;
  repo: string;
  url: string;
  category: CategoryId;
  description: Record<Language, string>;
  added: string | null;
  curated: boolean;
  topic: boolean;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  watchers: number | null;
  pushedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  license: string | null;
  language: string | null;
  homepage: string | null;
  archived: boolean;
  defaultBranch: string | null;
  maintenance: "active" | "warm" | "quiet" | "archived" | "unknown";
  manifest: PluginManifest;
  screenedCommit: string | null;
  installCommand: string | null;
  discovery: {
    source: "curated" | "topic";
    firstSeenAt: string;
    lastSeenAt: string;
  };
  screening: PluginScreening;
  attention: {
    level: "clear" | "review" | "caution";
    reasons: string[];
  };
}

export interface PluginRegistryData {
  schemaVersion: number;
  generatedAt: string;
  automation: {
    enabled: boolean;
    schedule: string;
    state: "bundled" | "live" | "degraded";
    scanVersion: number;
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    checkedThisRun: number;
    discoveredThisRun: number;
    admittedThisRun: number;
    rejectedTotal: number;
    error: string | null;
  };
  sources: {
    curated: {
      url: string;
      repository: string;
      state: "live" | "snapshot";
      updated: string;
      count: number;
    };
    topic: {
      url: string;
      query: string;
      state: "live" | "partial" | "snapshot";
      total: number;
      scanned: number;
      matched: number;
      error: string | null;
    };
  };
  summary: {
    curated: number;
    listed: number;
    autoDiscovered: number;
    topicTotal: number;
    metadataMatches: number;
    manifestMatches: number;
    screeningClear: number;
    screeningReview: number;
    screeningBlocked: number;
    owners: number;
    stars: number;
  };
  categories: Record<CategoryId, Record<Language, string>>;
  plugins: PluginRecord[];
}

export const pluginRegistry = sanitizeRegistryInstallEvidence(rawData) as unknown as PluginRegistryData;
