import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryFromText,
  classifyInspectionFailure,
  comparePluginsByEvidence,
  markInspectionUnavailable,
  manifestSummary,
  normalizeRepositoryPath,
  repositoryRootFiles,
  resolveRegistryScanLimit,
  sanitizePublicScanError,
  sanitizeRegistryInstallEvidence,
  screenRepository,
  selectFeaturedPlugins,
  selectRelatedPlugins,
  suggestedInstallCommand,
  visiblePluginName,
  inspectionQueuePriority,
} from "../lib/plugin-screening.mjs";

test("classifies deterministic oversized inspections for long backoff", () => {
  assert.equal(classifyInspectionFailure("Response exceeded 140000 bytes: https://example.test/client.js"), "uninspectable");
  assert.equal(classifyInspectionFailure("Response too large (400000 bytes): https://example.test/commit"), "uninspectable");
  assert.equal(classifyInspectionFailure("403 rate limit reached"), "transient");
  assert.equal(classifyInspectionFailure("network timeout"), "transient");
});

test("treats empty GitHub repositories as uninspectable instead of scan-degrading", () => {
  assert.equal(classifyInspectionFailure("409 Conflict: https://api.github.com/repos/uckkk/dsh-scaffold/commits/main"), "uninspectable");
  assert.equal(classifyInspectionFailure("Git Repository is empty."), "uninspectable");
  assert.doesNotMatch(sanitizePublicScanError("409 Conflict: https://api.github.com/repos/uckkk/dsh-scaffold/commits/main"), /github\.com|uckkk/u);
  assert.match(sanitizePublicScanError("409 Conflict: https://api.github.com/repos/uckkk/dsh-scaffold/commits/main"), /empty|default branch/u);
});

test("ranks clear plugins ahead of popular blocked plugins", () => {
  const blockedPopular = { screening: { state: "blocked" }, manifest: { state: "verified" }, stars: 2000, order: 1 };
  const clearQuiet = { screening: { state: "clear" }, manifest: { state: "verified" }, stars: 3, order: 9 };
  const review = { screening: { state: "review" }, manifest: { state: "verified" }, stars: 800, order: 2 };
  const ranked = [blockedPopular, review, clearQuiet].sort(comparePluginsByEvidence);
  assert.equal(ranked[0], clearQuiet);
  assert.equal(ranked[1], review);
  assert.equal(ranked[2], blockedPopular);
});

test("raises the default scan budget when a GitHub token is present", () => {
  assert.equal(resolveRegistryScanLimit({}), 7);
  assert.equal(resolveRegistryScanLimit({ token: "github-token" }), 40);
  assert.equal(resolveRegistryScanLimit({ token: "github-token", requested: "12" }), 12);
});

test("prioritizes listed plugins that still need a source scan", () => {
  assert.equal(inspectionQueuePriority({ screening: { scope: "manifest" } }), 0);
  assert.equal(inspectionQueuePriority({ screening: { scope: "source" } }), 1);
  assert.equal(inspectionQueuePriority(null), 2);
});

test("selects featured plugins without blocked entries", () => {
  const featured = selectFeaturedPlugins([
    { name: "blocked-star", stars: 900, screening: { state: "blocked" } },
    { name: "clear-mid", stars: 40, screening: { state: "clear" } },
    { name: "review-high", stars: 80, screening: { state: "review" } },
  ], 2);
  assert.deepEqual(featured.map((plugin) => plugin.name), ["clear-mid", "review-high"]);
});

test("prefers clear plugins in featured even when they have fewer stars", () => {
  const featured = selectFeaturedPlugins([
    { name: "review-hot", stars: 500, screening: { state: "review" } },
    { name: "clear-quiet", stars: 12, screening: { state: "clear" } },
    { name: "clear-mid", stars: 30, screening: { state: "clear" } },
  ], 2);
  assert.deepEqual(featured.map((plugin) => plugin.name), ["clear-mid", "clear-quiet"]);
});

test("picks related plugins from the same category", () => {
  const current = { id: "a/one", category: "tools", screening: { state: "clear" }, stars: 1 };
  const related = selectRelatedPlugins([
    current,
    { id: "b/two", category: "tools", screening: { state: "clear" }, stars: 9 },
    { id: "c/three", category: "ui", screening: { state: "clear" }, stars: 20 },
    { id: "d/four", category: "tools", screening: { state: "blocked" }, stars: 80 },
    { id: "e/five", category: "tools", screening: { state: "review" }, stars: 3 },
  ], current, 3);
  assert.deepEqual(related.map((plugin) => plugin.id), ["b/two", "e/five"]);
});

test("strips npm scopes from visible plugin names", () => {
  assert.equal(visiblePluginName({ name: "@nanmicoder/dsh-auto-mode", repo: "NanmiCoder/dsh-auto-mode" }), "dsh-auto-mode");
  assert.equal(visiblePluginName({ name: "dsh-board", repo: "dfkai/dsh-board" }), "dsh-board");
});

test("suggests a commit-pinned command when a screened commit exists", () => {
  assert.equal(
    suggestedInstallCommand({ repo: "owner/plugin", screenedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    "dsh plugin --profile web add github:owner/plugin#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(
    suggestedInstallCommand({ repo: "owner/plugin", screenedCommit: null }),
    "dsh plugin --profile web add github:owner/plugin",
  );
});

const safeMeta = {
  archived: false,
  license: { spdx_id: "MIT" },
};

function manifest(pkg = {}) {
  return manifestSummary({
    name: "safe-plugin",
    version: "1.0.0",
    main: "./lib/index.js",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    ...pkg,
  }, "main");
}

test("normalizes only repository-relative declared paths", () => {
  assert.equal(normalizeRepositoryPath("./src/index.ts"), "src/index.ts");
  assert.equal(normalizeRepositoryPath("../outside.ts"), null);
  assert.equal(normalizeRepositoryPath("/etc/passwd"), null);
  assert.equal(normalizeRepositoryPath("https://example.com/a.js"), null);
});

test("uses the authoritative root tree when checking repository evidence", () => {
  const files = repositoryRootFiles({
    truncated: false,
    tree: [
      { type: "blob", path: "package.json" },
      { type: "blob", path: "README.rst" },
      { type: "blob", path: "pnpm-lock.yaml" },
      { type: "tree", path: "src" },
    ],
  });
  const result = screenRepository({
    meta: safeMeta,
    manifest: manifest(),
    files,
    sourceFiles: [{ path: "lib/index.js", text: "export default {};" }],
    readme: "Security and permissions",
  });
  assert.equal(result.state, "clear");
  assert.equal(result.checks.lockfile, true);
  assert.equal(result.checks.readme, true);
  assert.throws(() => repositoryRootFiles({ truncated: true, tree: [] }), /incomplete/u);
});

test("treats a missing lockfile as informational instead of forcing review", () => {
  const result = screenRepository({
    meta: safeMeta,
    manifest: manifest(),
    files: ["README.md", "LICENSE", "package.json"],
    sourceFiles: [{ path: "lib/index.js", text: "export function apply(ctx) { return ctx; }" }],
    readme: "## Security\nNo network or shell access.",
  });
  assert.equal(result.state, "clear");
  assert.equal(result.checks.lockfile, false);
  assert.ok(result.findings.some((finding) => finding.id === "lockfile-missing" && finding.severity === "info"));
});

test("marks a fully inspectable local-only plugin as clear", () => {
  const result = screenRepository({
    meta: safeMeta,
    manifest: manifest(),
    files: ["README.md", "LICENSE", "pnpm-lock.yaml", "package.json"],
    sourceFiles: [{ path: "lib/index.js", text: "export function apply(ctx) { return ctx; }" }],
    readme: "## Security\nThis plugin has no network, shell, or file access.",
    checkedAt: "2026-08-14T00:00:00.000Z",
  });
  assert.equal(result.state, "clear");
  assert.equal(result.risk, "low");
  assert.equal(result.checks.source, true);
  assert.equal(result.checks.securityDisclosure, true);
});

test("flags lifecycle, network, filesystem, and credential access for review", () => {
  const result = screenRepository({
    meta: safeMeta,
    manifest: manifest({ scripts: { prepare: "npm run build" } }),
    files: ["README.md", "package.json"],
    sourceFiles: [{
      path: "lib/index.js",
      text: "const key = process.env.API_KEY; await fetch(url); await writeFile(path, key);",
    }],
    readme: "Plugin docs",
  });
  assert.equal(result.state, "review");
  assert.equal(result.risk, "medium");
  assert.ok(result.findings.some((finding) => finding.id === "lifecycle-script"));
  assert.ok(result.findings.some((finding) => finding.id === "network-egress"));
  assert.ok(result.findings.some((finding) => finding.id === "filesystem-write"));
  assert.ok(result.findings.some((finding) => finding.id === "credential-access"));
});

test("blocks permission bypass and dynamic code execution signals", () => {
  const result = screenRepository({
    meta: safeMeta,
    manifest: manifest(),
    files: ["README.md", "package-lock.json", "package.json"],
    sourceFiles: [{ path: "lib/index.js", text: "eval(code); run('--dangerously-skip-permissions');" }],
    readme: "Security boundary",
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.risk, "high");
  assert.ok(result.findings.some((finding) => finding.id === "permission-bypass"));
  assert.ok(result.findings.some((finding) => finding.id === "dynamic-code"));
});

test("extracts dsh manifest paths and classifies common plugin categories", () => {
  const summary = manifest({
    exports: { ".": { default: "./lib/index.js" }, "./client": "./lib/client.js" },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
  });
  assert.equal(summary.state, "verified");
  assert.deepEqual(summary.kinds, ["bundle", "client"]);
  assert.ok(summary.declaredPaths.includes("lib/client.js"));
  assert.equal(categoryFromText("desktop notification bridge"), "notify");
  assert.equal(categoryFromText("OCR vision document tool"), "tools");
});

test("withdraws stale installation evidence when a rescan cannot complete", () => {
  const previous = {
    defaultBranch: "main",
    manifest: manifest(),
    screenedCommit: "a".repeat(40),
    installCommand: `dsh plugin --profile web add github:owner/plugin#${"a".repeat(40)}`,
    discovery: { source: "curated", firstSeenAt: "2026-08-01", lastSeenAt: "2026-08-10" },
    screening: screenRepository({
      meta: safeMeta,
      manifest: manifest(),
      files: ["README.md", "package-lock.json"],
      sourceFiles: [{ path: "lib/index.js", text: "export const safe = true;" }],
      readme: "Security",
    }),
  };

  const unavailable = markInspectionUnavailable(previous, {
    kind: "error",
    checkedAt: "2026-08-14T10:00:00.000Z",
  });
  assert.equal(unavailable.installCommand, null);
  assert.equal(unavailable.screenedCommit, null);
  assert.equal(unavailable.screening.state, "review");
  assert.equal(unavailable.discovery.lastSeenAt, "2026-08-14T10:00:00.000Z");

  const rejected = markInspectionUnavailable(previous, {
    kind: "rejected",
    checkedAt: "2026-08-14T10:05:00.000Z",
  });
  assert.equal(rejected.installCommand, null);
  assert.equal(rejected.screening.state, "blocked");
  assert.equal(rejected.screening.risk, "high");
});

test("removes unpinned or mismatched commands from stored registry data", () => {
  const commit = "b".repeat(40);
  const base = {
    repo: "owner/plugin",
    curated: true,
    manifest: { state: "verified" },
    screening: { state: "review" },
  };
  const registry = sanitizeRegistryInstallEvidence({
    plugins: [
      { ...base, screenedCommit: null, installCommand: "dsh plugin --profile web add github:owner/plugin" },
      { ...base, screenedCommit: commit, installCommand: "dsh plugin --profile web add github:owner/plugin#wrong" },
      { ...base, screenedCommit: commit, installCommand: `dsh plugin --profile web add github:owner/plugin#${commit}` },
      { ...base, screening: { state: "clear" }, screenedCommit: commit, installCommand: `dsh plugin --profile web add github:owner/plugin#${commit}` },
    ],
  });
  assert.equal(registry.plugins[0].installCommand, null);
  assert.equal(registry.plugins[1].installCommand, null);
  assert.equal(registry.plugins[2].installCommand, null);
  assert.equal(registry.plugins[3].installCommand, `dsh plugin --profile web add github:owner/plugin#${commit}`);
});

test("reclassifies lockfile-only review plugins to clear and restores a pinned command", () => {
  const commit = "c".repeat(40);
  const registry = sanitizeRegistryInstallEvidence({
    summary: { screeningClear: 0, screeningReview: 1, screeningBlocked: 0 },
    plugins: [{
      repo: "owner/plugin",
      screenedCommit: commit,
      installCommand: null,
      manifest: { state: "verified" },
      screening: {
        scope: "source",
        state: "review",
        risk: "medium",
        findings: [{ id: "lockfile-missing", severity: "medium", label: { zh: "无锁文件", en: "No lockfile" } }],
      },
    }],
  });
  assert.equal(registry.plugins[0].screening.state, "clear");
  assert.equal(registry.plugins[0].screening.findings[0].severity, "info");
  assert.equal(registry.plugins[0].installCommand, `dsh plugin --profile web add github:owner/plugin#${commit}`);
  assert.equal(registry.summary.screeningClear, 1);
  assert.equal(registry.summary.screeningReview, 0);
});
