import assert from "node:assert/strict";
import test from "node:test";
import { readResponseTextLimited } from "../lib/limited-response.mjs";

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
