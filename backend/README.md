# FinFlow Backend

Node/Express API for FinFlow.

## Structure

- `src/server.js` - Express app entry point
- `src/routes/` - API route handlers
- `src/services/` - shared backend services
- `src/config/` - database setup and data access
- `data/` - local SQLite database files
- `compose/` - alternate dev-mode Docker Compose setup (hot-reload bind mounts); the root `docker-compose.yml` is the one to use for a normal local run
- `docs/` - archived project notes

## Run

```bash
npm install
npm start
```

Backend runs on:

- `http://localhost:3000`

From the project root, run both apps with Docker:

```bash
docker-compose up --build
```
