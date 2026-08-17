export const SCREENING_VERSION: number;
export function classifyInspectionFailure(value: unknown): "uninspectable" | "transient";
export function sanitizePublicScanError(value: unknown): string;
export function comparePluginsByEvidence(a: unknown, b: unknown): number;
export function resolveRegistryScanLimit(input?: { token?: string; requested?: string | number }): number;
export function suggestedInstallCommand(plugin: { repo?: string; screenedCommit?: string | null }, profile?: "web" | "default"): string;
export function displayInstallCommand(command: string | null | undefined, profile?: "web" | "default"): string;
export function pluginSearchHaystack(plugin: unknown, extras?: string[]): string;
export function matchesSearchQuery(haystack: string, query: string): boolean;
export function withPackageRunner(command: string | null | undefined, runner?: "dsh" | "npx"): string;
export function visiblePluginName(plugin: { name?: string; repo?: string }): string;
export function displayDescription(plugin: { description?: { zh?: string; en?: string } }, lang?: string): string;
export function selectFeaturedPlugins<T>(plugins: T[], limit?: number): T[];
export function selectRelatedPlugins<T>(plugins: T[], current: T | null | undefined, limit?: number): T[];
export function inspectionQueuePriority(previous: { screening?: { scope?: string } } | null | undefined): number;

export interface ScreeningManifest {
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

export interface ScreeningResult {
  version: number;
  scope: "manifest" | "source";
  state: "clear" | "review" | "blocked" | "pending";
  risk: "low" | "medium" | "high" | "unknown";
  checkedAt: string;
  findings: Array<{
    id: string;
    severity: "info" | "medium" | "high";
    label: { zh: string; en: string };
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

export function normalizeRepositoryPath(value: unknown): string | null;
export function repositoryRootFiles(value: unknown): string[];
export function manifestSummary(pkg: unknown, branch: string | null): ScreeningManifest;
export function baselineScreening(meta: unknown, manifest: ScreeningManifest, files?: string[], checkedAt?: string): ScreeningResult;
export function screenRepository(input: {
  meta: unknown;
  manifest: ScreeningManifest;
  files: string[];
  sourceFiles: Array<{ path: string; text: string }>;
  readme: string | null;
  checkedAt?: string;
}): ScreeningResult;
export function markInspectionUnavailable<T extends Record<string, unknown>>(
  previous: T,
  input: {
    kind: "error" | "rejected";
    checkedAt: string;
    manifest?: ScreeningManifest | null;
  },
): T & {
  manifest: ScreeningManifest;
  screenedCommit: null;
  installCommand: null;
  screening: ScreeningResult;
};
export function sanitizeRegistryInstallEvidence<T>(registry: T): T;
export function categoryFromText(value: unknown): "ui" | "session" | "tools" | "workflow" | "notify" | "dev" | "fun";
