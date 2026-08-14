const secret = process.env.CRON_SECRET?.trim();
if (!secret) throw new Error("CRON_SECRET is required");

const port = process.env.PORT?.trim() || "18200";
const response = await fetch(`http://127.0.0.1:${port}/api/cron/sync`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${secret}`,
    ...(process.env.REGISTRY_SCAN_LIMIT?.trim()
      ? { "X-Registry-Scan-Limit": process.env.REGISTRY_SCAN_LIMIT.trim() }
      : {}),
  },
  signal: AbortSignal.timeout(15 * 60 * 1_000),
});

const body = await response.text();
if (response.status === 409) {
  console.log(JSON.stringify({ event: "registry.sync.busy" }));
  process.exit(0);
}
if (!response.ok) {
  throw new Error(`Registry sync failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
}

const result = JSON.parse(body);
console.log(JSON.stringify({
  event: "registry.sync.request.complete",
  status: result.status,
  generatedAt: result.generatedAt,
  checked: result.checked,
  admitted: result.admitted,
  listed: result.listed,
}));
