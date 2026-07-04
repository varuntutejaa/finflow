# FinFlow Backend

Node/Express API for FinFlow.

## Features

- Authentication, account, transfer, and transaction APIs backed by PostgreSQL
- CSV import parsing with FinFlow export detection, validation, duplicate checks, and undo support
- Analytics endpoints for monthly spending trends, category totals, and transaction summaries

## Structure

- `src/server.js` - Express app entry point
- `src/routes/` - API route handlers
- `src/services/` - shared backend services
- `src/config/` - database setup and data access
- `scripts/local-postgres.mjs` - embedded PostgreSQL runner for local development without Docker
- `compose/` - alternate dev-mode Docker Compose setup (hot-reload bind mounts); the root `docker-compose.yml` is the one to use for a normal local run
- `docs/` - archived project notes

## Run

```bash
npm install
npm run db:local
```

In another terminal:

```bash
DATABASE_URL=postgres://finflow:finflow@localhost:54329/finflow npm start
```

Backend runs on:

- `http://localhost:3000`

For production, set `NODE_ENV=production`, a real `DATABASE_URL`, a 32+ character `JWT_SECRET`, and `CORS_ORIGIN` to the deployed frontend origin.

From the project root, run both apps with Docker:

```bash
docker-compose up --build
```
