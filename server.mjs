import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleChat } from "./lib/chat.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed.");
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
