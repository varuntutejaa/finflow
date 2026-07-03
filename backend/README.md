# FinFlow Backend

Node/Express API for FinFlow.

## Structure

- `src/server.js` - Express app entry point
- `src/routes/` - API route handlers
- `src/services/` - shared backend services
- `src/config/` - database setup and data access
- `data/` - local SQLite database files
- `compose/` - Docker Compose setup for frontend and backend
- `docs/` - archived project notes

## Run

```bash
npm install
npm start
```

From the project root, run both apps with Docker:

```bash
docker compose -f backend/compose/docker-compose.yml up --build
```
