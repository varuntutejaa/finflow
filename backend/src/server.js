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

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
// Statement imports (base64 PDFs especially) can exceed the 100kb default.
app.use(express.json({ limit: "15mb" }));

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});
