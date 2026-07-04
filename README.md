# 💸 FinFlow

FinFlow is a full-stack personal finance app — send money, track spending, split bills with friends, manage budgets, and keep an eye on your investments, all in one place.

Built with a **React + TypeScript** frontend and a **Node/Express + SQLite** backend, fully containerized with Docker for a one-command local setup.

---

## ✨ Features

### 💳 Payments & Accounts
- User authentication with PIN-protected balance checks
- Account-to-account money transfers
- QR code pay — generate your own pay QR or scan someone else's to pay them

### 📊 Transactions & Analytics
- Full transaction history with search, category, date, amount, and transfer-direction filters
- Downloadable account statements (CSV)
- Spending analytics with monthly trend charts, category breakdowns, and summary insights

### 📥 Statement Import
- Import bank statements from **CSV or PDF**
- Automatic duplicate detection
- Batch undo for an entire import
- Per-row review and re-categorization after import

### 💰 Budgets
- Set category-level budgets and track spend against them
- Review and resolve uncategorized transactions

### 🤝 Split Expenses
- Create groups and split expenses with friends
- Search and add users to a group
- Track settlements and pay outstanding balances directly

### 🔁 Recurring Payments
- Schedule recurring transfers to other accounts

### 📈 Investments
- Track investments by symbol / mutual fund scheme code
- Live price feed integration

---

## 🧱 Tech Stack

| Layer          | Technology                                                                 |
|----------------|-----------------------------------------------------------------------------|
| Frontend       | React 19, TypeScript, Vite                                                  |
| Backend        | Node.js, Express                                                            |
| Database       | SQLite (via `better-sqlite3`)                                               |
| Auth           | JWT (`jsonwebtoken`)                                                        |
| File Handling  | `multer` (uploads), `pdf-parse` (PDF statements), `exceljs` (spreadsheets)  |
| QR Codes       | `qrcode` (generate), `jsqr` (scan)                                          |
| Tooling        | ESLint, TypeScript-ESLint                                                   |
| Infra          | Docker & Docker Compose                                                     |

---

## 🚀 Getting Started

### Option 1: Docker (recommended)

Runs the entire app — frontend, backend, and database — with a single command from the project root:

```bash
docker-compose up --build
```

Then open:
- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000

### Option 2: Run locally without Docker

**Backend**

```bash
cd backend
npm install
npm start
```
The API server starts on `http://localhost:3000` (configurable via the `PORT` env var). Data is stored in a local SQLite file; set `DATA_DIR` to control where it's written.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```
The dev server starts on `http://localhost:5173` and expects the backend at `http://localhost:3000` (configurable via `VITE_API_URL`).

---

## 📁 Project Structure

```
finflow/
├── backend/                  # Node/Express API
│   ├── src/
│   │   ├── config/           # SQLite schema & data access (database, imports, investments, recurring, splits)
│   │   ├── routes/           # Express route handlers (auth, accounts, transactions, budgets, groups, imports, investments, recurring, analytics)
│   │   ├── services/         # Auth/session logic
│   │   └── server.js         # App entrypoint
│   └── Dockerfile
├── frontend/                 # React + TypeScript client
│   ├── src/
│   │   ├── api/              # Backend API client
│   │   ├── components/       # Feature components (accounts, analytics, auth, budgets, investments, split, transactions, transfers, shared)
│   │   ├── styles/           # Global styles
│   │   └── utils/            # Shared helpers
│   └── Dockerfile
├── docker-compose.yml        # Local multi-service setup
└── README.md
```

---

## 🔌 Backend API Overview

| Route              | Purpose                                      |
|---------------------|-----------------------------------------------|
| `/api/auth`         | Sign up, log in, session management           |
| `/api/accounts`     | Account creation and balances                 |
| `/api/transactions` | Transaction history, filters, statements      |
| `/api/imports`      | CSV/PDF statement import & batch management   |
| `/api/budgets`      | Category budgets                              |
| `/api/groups`       | Split-expense groups and settlements          |
| `/api/recurring`    | Recurring payment schedules                   |
| `/api/investments`  | Investment tracking and price feeds           |
| `/api/analytics`    | Spending trends and summary insights          |

All routes (aside from auth) require a valid JWT, issued at login.

---

## ⚙️ Environment Variables

| Variable      | Used by  | Description                                  | Default                     |
|---------------|----------|-----------------------------------------------|------------------------------|
| `PORT`        | backend  | Port the API server listens on                | `3000`                       |
| `DATA_DIR`    | backend  | Directory for the SQLite data file            | project-local                |
| `JWT_SECRET`  | backend  | Secret used to sign auth tokens               | *(set in docker-compose)*    |
| `VITE_API_URL`| frontend | Base URL the frontend uses to call the API    | `http://localhost:3000`      |

---

## 🧪 Linting

```bash
cd frontend
npm run lint
```

---

## 📄 License

This project currently has no license file — all rights reserved by the author unless otherwise stated.
