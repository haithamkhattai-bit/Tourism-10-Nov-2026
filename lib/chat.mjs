const maxBodyBytes = 16 * 1024;
const systemPrompt =
  "You are Dubai, UAE's friendly and practical tourism assistant. Help visitors plan activities, neighborhoods, transport, food, culture, and itineraries. Ask a brief clarifying question when needed. Give clear, concise suggestions and mention when opening hours, prices, visa rules, or other details may change and should be checked with official sources. Do not invent real-time information.";

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

async function getUpstreamError(upstream) {
  const body = await upstream.text();
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || `HTTP ${upstream.status}`;
  } catch {
    return `HTTP ${upstream.status}`;
  }
}

export async function handleChat(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

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
      error: "Azure OpenAI is not configured. Check the required values in your environment.",
    });
    return;
  }

  const isResponsesEndpoint = /\/responses(?:\?|$)/.test(endpoint);
  const isV1Endpoint = /\/openai\/v1(?:\/|$)/.test(endpoint);
  let upstreamUrl = endpoint;
  let upstreamBody;
  const upstreamHeaders = {
    "Content-Type": "application/json",
    "api-key": apiKey,
  };

  if (isResponsesEndpoint) {
    const url = new URL(endpoint);
    if (!isV1Endpoint && apiVersion && !url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", apiVersion);
    }
    upstreamUrl = url.toString();
    upstreamBody = JSON.stringify({
      model: deployment,
      input: [
        { role: "system", content: systemPrompt },
        ...messages.map(({ role, content }) => ({ role, content })),
      ],
      max_output_tokens: 2048,
    });
  } else {
    const url = new URL(
      endpoint.includes("/chat/completions") || endpoint.includes("/deployments/")
        ? endpoint
        : `${endpoint}/chat/completions`,
    );
    if (!isV1Endpoint && apiVersion && !url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", apiVersion);
    }
    upstreamUrl = url.toString();
    upstreamBody = JSON.stringify({
      model: deployment,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
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
      const detail = await getUpstreamError(upstream);
      console.error(`Azure OpenAI returned HTTP ${upstream.status}: ${detail}`);
      sendJson(response, 502, {
        error: `Azure OpenAI could not answer (HTTP ${upstream.status}). Check the deployment configuration.`,
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
