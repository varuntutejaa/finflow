# FinFlow

FinFlow is a full-stack money transfer app with a React frontend and a Node/Express backend.

## Features

- User authentication, PIN setup, account balances, and account-to-account transfers
- Transaction history with search, category, date, amount, and transfer-direction filters
- CSV transaction import with duplicate detection, batch undo, and per-row import review
- Spending analytics with monthly trends, category breakdowns, and summary insights

## Local Run

Run the full app from the project root:

```bash
docker-compose up --build
```

## Ports

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`

## Project Structure

- `frontend/` - React + TypeScript + Vite client
- `backend/` - Node/Express API with SQLite
- `docker-compose.yml` - local multi-service setup for judges
