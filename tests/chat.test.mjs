import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { handleChat } from "../lib/chat.mjs";

function createRequest(payload) {
  const request = Readable.from([Buffer.from(JSON.stringify(payload))]);
  request.method = "POST";
  return request;
}

function createResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("Azure v1 Responses requests use valid input and omit the API version query", async () => {
  const originalEnv = {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  };
  const originalFetch = globalThis.fetch;
  let upstreamRequest;

  process.env.AZURE_OPENAI_ENDPOINT = "https://example.services.ai.azure.com/openai/v1/responses";
  process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_API_VERSION = "2025-08-07";
  globalThis.fetch = async (url, options) => {
    upstreamRequest = { url: String(url), options };
    return new Response(
      JSON.stringify({
        output: [{ content: [{ type: "output_text", text: "Welcome to Dubai." }] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const response = createResponse();
    await handleChat(createRequest({
      messages: [
        { role: "user", content: "Plan a 3-day visit." },
        { role: "assistant", content: "What do you enjoy?" },
      ],
    }), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { reply: "Welcome to Dubai." });
    assert.equal(upstreamRequest.url, "https://example.services.ai.azure.com/openai/v1/responses");
    assert.equal(upstreamRequest.options.headers["api-key"], "test-key");

    const body = JSON.parse(upstreamRequest.options.body);
    assert.equal(body.model, "test-deployment");
    assert.equal(body.max_output_tokens, 2048);
    assert.deepEqual(body.input.map(({ role }) => role), ["system", "user", "assistant"]);
    assert.equal(body.input[1].content, "Plan a 3-day visit.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      AZURE_OPENAI_ENDPOINT: originalEnv.endpoint,
      AZURE_OPENAI_DEPLOYMENT: originalEnv.deployment,
      AZURE_OPENAI_API_KEY: originalEnv.apiKey,
      AZURE_OPENAI_API_VERSION: originalEnv.apiVersion,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
