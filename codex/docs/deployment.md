# Deployment Notes

The current production shape is a single Node service that serves both the API and the built Vite dashboard.

## Required Environment

- `STEAMBENCH_API_PORT`: defaults to `8787`.
- `STEAM_WEB_API_KEY`: required only for linked-user achievement proof.
- `STEAMBENCH_STORE_PATH`: optional JSON store path for the prototype persistence layer.

## Local Production Smoke

```bash
npm ci
npm run build
npm run start
npm run smoke:api
```

## Railway

`railway.toml` points Railway at the included Dockerfile and uses `/api/health` as the health check. The prototype JSON store is suitable for a first smoke deployment only; a managed Postgres store should replace it before real public runs.

## Vercel

The frontend can be deployed as a static Vite app, but the API needs a server runtime. For a split deployment, set Vite proxy/API base URLs to the Railway API. For a single deployment, use the Docker service.

## Runtime Agents

Agent gameplay should run outside the web API in a Steam-capable VM or container. The API receives run events, artifacts, Steam proof, and scores. Modal is a natural fit for running the Steam VM worker once the game images and account-state handling are ready.
