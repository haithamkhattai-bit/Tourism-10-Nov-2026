# Dubai, Your Way

A Dubai tourism chat assistant powered by your Azure OpenAI deployment. The API key is read by the local server from `.env` and is never sent to the browser.

## Run locally

1. Copy `.env.example` to `.env`.
2. Fill in your Azure values in `.env` (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY`). For Azure OpenAI v1 endpoints, use the `/openai/v1/responses` endpoint; an API version query parameter is not needed.
3. Start the server with `npm start` (Node.js 18 or newer).
4. Open [http://localhost:3000](http://localhost:3000).

Important: `.env` is intentionally ignored by Git so your Azure credentials stay local and are never committed to the repository. Keep the `.env.example` file versioned as a safe template instead.

The server binds to `127.0.0.1` so it is only accessible from this computer. To change the port, set `PORT` before starting the server.

## Deploy to Vercel

Import the GitHub repository into Vercel and set `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY` in the project's Environment Variables for the desired deployment environments. The `/api/chat` serverless function and static files are deployed from this repository. Do not upload `.env` or commit credentials.
