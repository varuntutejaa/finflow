import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import accountsRouter from "./routes/accounts.js";
import transactionsRouter from "./routes/transactions.js";
import budgetsRouter from "./routes/budgets.js";
import groupsRouter from "./routes/groups.js";
import importsRouter from "./routes/imports.js";
import analyticsRouter from "./routes/analytics.js";
import recurringRouter from "./routes/recurring.js";
import investmentsRouter from "./routes/investments.js";
import { runDueRecurringPayments } from "./config/recurringDatabase.js";

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  })
);
// Statement imports are streamed as multipart/form-data (see routes/imports.js),
// so JSON stays small and is never used as a file transport.
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/imports", importsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/recurring", recurringRouter);
app.use("/api/investments", investmentsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});

// In-process scheduler for standing instructions — there's no external cron
// or job queue here, so due recurring payments are checked and fired on a
// simple interval instead.
setInterval(() => {
  runDueRecurringPayments().catch((err) => {
    console.error("Recurring payment run failed:", err);
  });
}, 60_000);
