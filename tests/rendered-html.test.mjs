import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const root = new URL("../", import.meta.url);
const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let baseUrl;
let serverProcess;
let registryDirectory;
let serverOutput = "";

async function availablePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClosed) => server.close(resolveClosed));
  return port;
}

before(async () => {
  registryDirectory = await mkdtemp(resolve(tmpdir(), "dsh-plugin-hub-test-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: rootPath,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      REGISTRY_DATA_DIR: registryDirectory,
      CRON_SECRET: "integration-test-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [serverProcess.stdout, serverProcess.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
    });
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Standalone server exited early:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/registry/status`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Standalone server did not become ready:\n${serverOutput}`);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => serverProcess.once("exit", resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
    if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
  }
  if (registryDirectory) await rm(registryDirectory, { recursive: true, force: true });
});

async function request(path = "/", accept = "text/html") {
  return fetch(`${baseUrl}${path}`, { headers: { accept } });
}

test("server-renders the complete plugin hub", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /<title>DSH 插件资源站<\/title>/i);
  assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/i);
  assert.match(html, /data-theme="light"/i);
  assert.match(html, /一切皆插件/);
  assert.match(html, /先看证据/);
  assert.match(html, new RegExp(String(registry.summary.listed)));
  assert.match(html, new RegExp(String(registry.summary.manifestMatches)));
  assert.match(html, /30 MIN/);
  assert.match(html, /自动发现/);
  assert.match(html, /作者：岚叔/);
  assert.match(html, /JSON API/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("serves shareable pages and plugin detail metadata", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  for (const [path, expected] of [
    ["/plugins?q=tool", "插件目录"],
    ["/rank", "排行榜"],
    ["/submit", "让你的插件被看见"],
    ["/guide", "从一个可检查的插件开始"],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), new RegExp(expected), path);
  }

  const plugin = registry.plugins[0];
  const response = await request(`/plugin/${plugin.id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(`<title>${plugin.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
  assert.match(html, /role="dialog"/);
  assert.match(html, new RegExp(`rel="canonical" href="https://apiu.cc/plugin/${plugin.id}`));
});

test("serves the real registry through the JSON API", async () => {
  const response = await request("/api/plugins", "application/json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");

  const body = await response.json();
  assert.equal(body.schemaVersion, 2);
  assert.equal(body.plugins.length, body.summary.listed);
  assert.ok(body.summary.curated <= body.plugins.length);
  assert.ok(body.summary.topicTotal >= body.summary.curated);
  assert.ok(body.summary.manifestMatches >= 180);
  assert.equal(body.automation.schedule, "*/30 * * * *");
  assert.equal(response.headers.get("x-registry-source"), "bundled-fallback");
  assert.equal(body.sources.curated.state, "live");
  assert.equal(body.sources.topic.state, "live");
  assert.ok(body.plugins.every((plugin) => plugin.url.startsWith("https://github.com/")));
  assert.ok(body.plugins.every((plugin) => plugin.screening && plugin.discovery));
  assert.ok(body.plugins.every((plugin) => (
    plugin.installCommand === null
    || (/^[a-f\d]{40,64}$/iu.test(plugin.screenedCommit)
      && plugin.installCommand.endsWith(`#${plugin.screenedCommit}`))
  )));

  const cached = await fetch(`${baseUrl}/api/plugins`, {
    headers: { "If-None-Match": response.headers.get("etag") },
  });
  assert.equal(cached.status, 304);
});

test("serves a compact public registry status endpoint", async () => {
  const response = await request("/api/registry/status", "application/json");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.automation.enabled, true);
  assert.equal(body.summary.listed, body.summary.screeningClear + body.summary.screeningReview + body.summary.screeningBlocked);
});

test("rejects invalid public repository preflight input without upstream access", async () => {
  const response = await fetch(`${baseUrl}/api/repository/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/not-github" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /只支持|GitHub/u);
});

test("reads a persisted registry from the self-hosted file store", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  registry.generatedAt = "2026-08-15T00:00:00.000Z";
  await writeFile(resolve(registryDirectory, "plugin-registry-store.json"), JSON.stringify({
    registry,
    state: { cursorPage: 2, seen: {} },
  }), { mode: 0o600 });

  const response = await request("/api/plugins", "application/json");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-registry-source"), "node-file");
  assert.equal((await response.json()).generatedAt, "2026-08-15T00:00:00.000Z");
});

test("rejects unauthenticated registry synchronization", async () => {
  const response = await fetch(`${baseUrl}/api/cron/sync`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });

  const wrongSecret = await fetch(`${baseUrl}/api/cron/sync`, {
    method: "POST",
    headers: { Authorization: "Bearer wrong-secret" },
  });
  assert.equal(wrongSecret.status, 401);
});

test("prevents overlapping authenticated synchronizations", async () => {
  const lockPath = resolve(registryDirectory, "plugin-registry-sync.lock");
  await writeFile(lockPath, JSON.stringify({ token: "existing", pid: 1 }), { mode: 0o600 });
  try {
    const response = await fetch(`${baseUrl}/api/cron/sync`, {
      method: "POST",
      headers: { Authorization: "Bearer integration-test-secret" },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { status: "busy" });
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
});

test("copies public assets into standalone output", async () => {
  const response = await request("/favicon.svg", "image/svg+xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/svg\+xml/i);
});

test("keeps the generated registry internally consistent", async () => {
  const [generatedText, publicText, packageText] = await Promise.all([
    readFile(new URL("data/plugins.generated.json", root), "utf8"),
    readFile(new URL("public/plugins.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  const registry = JSON.parse(generatedText);
  const ids = registry.plugins.map((plugin) => plugin.id);
  const verified = registry.plugins.filter((plugin) => plugin.manifest.state === "verified");

  assert.equal(publicText, generatedText);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(verified.length, registry.summary.manifestMatches);
  assert.ok(verified.every((plugin) => plugin.screenedCommit === null && plugin.installCommand === null));
  assert.equal(registry.plugins.length, registry.summary.listed);
  assert.equal(
    registry.plugins.filter((plugin) => plugin.screening.state === "blocked").length,
    registry.summary.screeningBlocked,
  );
  assert.ok(
    registry.plugins
      .filter((plugin) => plugin.manifest.state !== "verified")
      .every((plugin) => plugin.installCommand === null),
  );
  assert.doesNotMatch(packageText, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
