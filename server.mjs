import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 16 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadEnvFile();

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.value || "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    return content.text || content.value || "";
  }
  return "";
}

function extractAssistantReply(result) {
  const chatText = extractTextFromContent(result?.choices?.[0]?.message?.content);
  if (chatText.trim()) return chatText;

  const outputText = (result?.output || [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : [item]))
    .map((part) => extractTextFromContent(part))
    .join("");
  if (outputText.trim()) return outputText;

  return extractTextFromContent(result?.output_text) || extractTextFromContent(result?.content) || "";
}

async function handleChat(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }

  const messages = payload?.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    messages.some(
      (message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        message.content.length > 4000,
    )
  ) {
    sendJson(response, 400, { error: "Please send a valid chat message." });
    return;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  if (!endpoint || !deployment || !apiKey) {
    sendJson(response, 503, {
      error: "Azure OpenAI is not configured. Check the required values in your .env file.",
    });
    return;
  }

  const requestMessages = [
    {
      role: "system",
      content:
        "You are Dubai, UAE's friendly and practical tourism assistant. Help visitors plan activities, neighborhoods, transport, food, culture, and itineraries. Ask a brief clarifying question when needed. Give clear, concise suggestions and mention when opening hours, prices, visa rules, or other details may change and should be checked with official sources. Do not invent real-time information.",
    },
    ...messages,
  ];

  let upstreamUrl = endpoint;
  let upstreamBody;
  let upstreamHeaders = {
    "Content-Type": "application/json",
    "api-key": apiKey,
  };

  if (endpoint.includes("/responses")) {
    const url = new URL(endpoint);
    if (apiVersion && !url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", apiVersion);
    }
    upstreamUrl = url.toString();
    upstreamBody = JSON.stringify({
      model: deployment,
      input: requestMessages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: [{ type: "input_text", text: message.content }],
      })),
    });
  } else {
    const url = new URL(
      endpoint.includes("/chat/completions") || endpoint.includes("/deployments/")
        ? endpoint
        : `${endpoint}/chat/completions`,
    );
    if (apiVersion && !url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", apiVersion);
    }
    upstreamUrl = url.toString();
    upstreamBody = JSON.stringify({
      model: deployment,
      messages: requestMessages,
      reasoning_effort: "low",
      max_completion_tokens: 2048,
    });
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBody,
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      console.error(`Azure OpenAI returned HTTP ${upstream.status}.`);
      sendJson(response, 502, {
        error: `Azure OpenAI could not answer (HTTP ${upstream.status}). Check your Azure deployment and key.`,
      });
      return;
    }

    const result = await upstream.json();
    const answer = extractAssistantReply(result);
    if (!answer.trim()) {
      const finishReason = result?.choices?.[0]?.finish_reason || "unknown";
      const refusal = result?.choices?.[0]?.message?.refusal;
      console.error(
        `Azure OpenAI returned no text (finish reason: ${finishReason}, completion tokens: ${result?.usage?.completion_tokens ?? "unknown"}).`,
      );
      sendJson(response, 502, {
        error:
          (typeof refusal === "string" && refusal) ||
          (finishReason === "length"
            ? "The answer exceeded the model's response limit. Please try a shorter question."
            : "Azure OpenAI returned no text. Please try again."),
      });
      return;
    }

    sendJson(response, 200, { reply: answer });
  } catch (error) {
    console.error(`Azure OpenAI request failed: ${error.message}`);
    sendJson(response, 502, {
      error: "Could not reach Azure OpenAI. Check your connection and Azure endpoint.",
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const requestedFile = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!["index.html", "styles.css", "app.js"].includes(requestedFile)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const file = await readFile(path.join(publicDir, requestedFile));
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(requestedFile)],
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    });
    response.end(file);
  } catch (error) {
    console.error(`Could not serve ${requestedFile}: ${error.message}`);
    response.writeHead(500);
    response.end("Could not load the app.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Dubai Tourism Bot is running at http://localhost:${port}`);
});
