# Dubai, Your Way

A Dubai tourism chat assistant powered by your Azure OpenAI deployment. The API key is read by the local server from `.env` and is never sent to the browser.

## Run locally

1. Make sure `.env` contains `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`.
2. Start the server with `npm start` (Node.js 18 or newer).
3. Open [http://localhost:3000](http://localhost:3000).

The server binds to `127.0.0.1` so it is only accessible from this computer. To change the port, set `PORT` before starting the server.
