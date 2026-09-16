import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, decodeApiResponse } from "../src/api";

test("browser preserves a JSON API error and code", async () => {
  await assert.rejects(
    decodeApiResponse(
      new Response(
        JSON.stringify({
          error: "Bedrock returned an incomplete course map.",
          code: "MODEL_OUTPUT_INVALID",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      error.code === "MODEL_OUTPUT_INVALID" &&
      /incomplete course map/i.test(error.message),
  );
});

test("plain-text proxy 502 explains that the local server is unavailable", async () => {
  await assert.rejects(
    decodeApiResponse(
      new Response("Bad Gateway", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      /npm run dev/i.test(error.message),
  );
});

test("valid JSON responses still decode normally", async () => {
  const result = await decodeApiResponse<{ configured: boolean }>(
    new Response('{"configured":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(result.configured, true);
});

