import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function request(path = "/", accept = "text/html") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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
});

test("serves a compact public registry status endpoint", async () => {
  const response = await request("/api/registry/status", "application/json");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.automation.enabled, true);
  assert.equal(body.summary.listed, body.summary.screeningClear + body.summary.screeningReview + body.summary.screeningBlocked);
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
