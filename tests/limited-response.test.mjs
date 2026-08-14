import assert from "node:assert/strict";
import test from "node:test";
import { readResponseTextLimited } from "../lib/limited-response.mjs";
import { createPreflightLimiter } from "../lib/preflight-limiter.mjs";

function responseFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

test("reads a response without crossing the byte limit", async () => {
  const response = responseFromChunks(["hello", " ", "世界"]);
  assert.equal(await readResponseTextLimited(response, 12), "hello 世界");
});

test("cancels an oversized response before returning buffered text", async () => {
  const response = responseFromChunks(["1234", "5678"]);
  await assert.rejects(readResponseTextLimited(response, 7), RangeError);
});

test("bounds clients independently from the shared GitHub budget", () => {
  const limiter = createPreflightLimiter({
    clientLimit: 2,
    clientWindowMs: 100,
    githubLimit: 2,
    githubWindowMs: 1_000,
  });
  assert.equal(limiter.allowClient("a", 1), true);
  assert.equal(limiter.allowClient("a", 2), true);
  assert.equal(limiter.allowClient("a", 3), false);
  assert.equal(limiter.allowClient("b", 3), true);
  assert.equal(limiter.allowClient("a", 101), true);

  assert.equal(limiter.reserveGithub(false, 1), true);
  assert.equal(limiter.reserveGithub(false, 2), true);
  assert.equal(limiter.reserveGithub(false, 3), false);
  assert.equal(limiter.reserveGithub(true, 3), true);
  assert.equal(limiter.reserveGithub(false, 1_001), true);
});
