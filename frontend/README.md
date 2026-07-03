# FinFlow Frontend

React + TypeScript + Vite client for FinFlow.

## Features

- Transfer workflow, account overview, and searchable transaction history
- Import review UI for uploaded transaction CSVs, including duplicate warnings and undo actions
- Analytics dashboard with category and monthly trend charts

## Structure

- `src/api/` - API client and shared API types
- `src/components/auth/` - login, signup, and PIN setup UI
- `src/components/accounts/` - account display UI
- `src/components/transfers/` - transfer workflow UI
- `src/components/transactions/` - transaction history UI
- `src/components/analytics/` - spending analytics dashboard and chart components
- `src/components/shared/` - reusable UI components
- `src/styles/` - app and global styles
- `public/` - static assets

## Run

```bash
npm install
npm run dev
```

Frontend runs on:

- `http://localhost:5173`

When running the full app with Docker from the project root:

```bash
docker-compose up --build
```
