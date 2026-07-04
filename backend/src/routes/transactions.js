import { Router } from "express";
import { Readable } from "stream";
import {
  transfer,
  transferToOwnAccount,
  listTransactions,
  iterateTransactions,
  getTransaction,
  getUserRawById,
  getAccount,
  listAccounts,
  TransferError,
  isValidBudgetCategoryName,
  updateTransactionCategory,
  updateTransaction,
  checkTransferRateLimit,
} from "../config/database.js";
import { requireAuth, checkPinAuthorization } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const MAX_TRANSFER_AMOUNT = 50000000;
const TRANSFER_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSFER_RATE_LIMIT_COUNT = 8;

function enforceTransferRateLimit(req, res, next) {
  const allowed = checkTransferRateLimit(req.userId, TRANSFER_RATE_LIMIT_WINDOW_MS, TRANSFER_RATE_LIMIT_COUNT);
  if (!allowed) {
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many transfer attempts. Please wait a moment and try again.",
      },
    });
  }
  next();
}

router.post("/transfer", enforceTransferRateLimit, (req, res) => {
  const { fromAccountId, toUsername, amount, idempotencyKey, pin, category, note } = req.body ?? {};

  if (typeof fromAccountId !== "string" || typeof toUsername !== "string" || toUsername.trim().length === 0) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_ACCOUNT", message: "fromAccountId and toUsername are required" } });
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_AMOUNT", message: "amount must be a positive integer (cents)" } });
  }
  if (amount > MAX_TRANSFER_AMOUNT) {
    return res.status(400).json({
      error: {
        code: "TRANSFER_LIMIT_EXCEEDED",
        message: "amount exceeds the maximum allowed transfer limit",
      },
    });
  }
  if (!isValidBudgetCategoryName(category)) {
    return res.status(400).json({
      error: {
        code: "INVALID_CATEGORY",
        message: "category must be a valid budgeting category name",
      },
    });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be a string" } });
  }
  if (typeof note === "string" && note.length > 280) {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be 280 characters or fewer" } });
  }
  if (
    idempotencyKey !== undefined &&
    idempotencyKey !== null &&
    (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(idempotencyKey))
  ) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "idempotencyKey must be 1-128 safe characters" } });
  }

  // PIN verification is mandatory for every transfer — no account, old or new,
  // is allowed to move money without proving its UPI PIN.
  const user = getUserRawById(req.userId);
  if (!user) {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
  }
  const authError = checkPinAuthorization(user, pin);
  if (authError) {
    return res.status(authError.status).json({
      error: {
        code: authError.code,
        message: authError.message,
        unlockAt: authError.unlockAt,
        attemptsRemaining: authError.attemptsRemaining,
      },
    });
  }

  try {
    const { transaction, replayed } = transfer({
      userId: req.userId,
      fromAccountId,
      toUsername: toUsername.trim().toLowerCase(),
      amount,
      idempotencyKey,
      category,
      note,
    });
    res.status(replayed ? 200 : 201).json({
      transaction,
      replayed,
      accounts: listAccounts(req.userId),
    });
  } catch (err) {
    if (err instanceof TransferError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message },
        transaction: err.transaction ?? undefined,
      });
    }
    throw err;
  }
});

router.post("/self-transfer", enforceTransferRateLimit, (req, res) => {
  const { fromAccountId, toAccountId, amount, idempotencyKey, pin, note } = req.body ?? {};

  if (typeof fromAccountId !== "string" || typeof toAccountId !== "string") {
    return res
      .status(400)
      .json({ error: { code: "INVALID_ACCOUNT", message: "fromAccountId and toAccountId are required" } });
  }
  if (fromAccountId === toAccountId) {
    return res
      .status(400)
      .json({ error: { code: "SAME_ACCOUNT", message: "Choose two different accounts to transfer between" } });
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_AMOUNT", message: "amount must be a positive integer (cents)" } });
  }
  if (amount > MAX_TRANSFER_AMOUNT) {
    return res.status(400).json({
      error: {
        code: "TRANSFER_LIMIT_EXCEEDED",
        message: "amount exceeds the maximum allowed transfer limit",
      },
    });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be a string" } });
  }
  if (typeof note === "string" && note.length > 280) {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be 280 characters or fewer" } });
  }
  if (
    idempotencyKey !== undefined &&
    idempotencyKey !== null &&
    (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(idempotencyKey))
  ) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "idempotencyKey must be 1-128 safe characters" } });
  }

  const user = getUserRawById(req.userId);
  if (!user) {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
  }
  const authError = checkPinAuthorization(user, pin);
  if (authError) {
    return res.status(authError.status).json({
      error: {
        code: authError.code,
        message: authError.message,
        unlockAt: authError.unlockAt,
        attemptsRemaining: authError.attemptsRemaining,
      },
    });
  }

  try {
    const { transaction, replayed } = transferToOwnAccount({
      userId: req.userId,
      fromAccountId,
      toAccountId,
      amount,
      idempotencyKey,
      note,
    });
    res.status(replayed ? 200 : 201).json({
      transaction,
      replayed,
      accounts: listAccounts(req.userId),
    });
  } catch (err) {
    if (err instanceof TransferError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message },
        transaction: err.transaction ?? undefined,
      });
    }
    throw err;
  }
});

const stringParam = (value) => (typeof value === "string" && value.trim() ? value : undefined);
const numberParam = (value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function transactionFiltersFromQuery(req) {
  return {
    userId: req.userId,
    accountId: stringParam(req.query.accountId),
    search: stringParam(req.query.search),
    category: stringParam(req.query.category),
    dateFrom: stringParam(req.query.dateFrom),
    dateTo: stringParam(req.query.dateTo),
    minAmount: numberParam(req.query.minAmount),
    maxAmount: numberParam(req.query.maxAmount),
    direction: stringParam(req.query.direction),
    status: stringParam(req.query.status),
    referenceId: stringParam(req.query.referenceId),
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells) {
  return `${cells.map(csvCell).join(",")}\n`;
}

function transactionDescription(row, currentUsername) {
  if (row.from_username === row.to_username) return `${row.from_account_name} -> ${row.to_account_name}`;
  return row.from_username === currentUsername
    ? `To ${row.to_name} (@${row.to_username})`
    : `From ${row.from_name} (@${row.from_username})`;
}

router.get("/export.csv", (req, res) => {
  const filters = transactionFiltersFromQuery(req);
  const filename = `finflow-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  const user = getUserRawById(req.userId);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  function* rows() {
    yield csvRow(["Date", "Description", "Category", "From", "To", "Amount (INR)", "Status", "Note"]);
    for (const row of iterateTransactions(filters)) {
      yield csvRow([
        row.created_at,
        transactionDescription(row, user?.username),
        row.category,
        `${row.from_name} (@${row.from_username})`,
        `${row.to_name} (@${row.to_username})`,
        (row.amount / 100).toFixed(2),
        row.status,
        row.note ?? "",
      ]);
    }
  }

  Readable.from(rows()).on("error", (err) => res.destroy(err)).pipe(res);
});

router.get("/accounts/:accountId/statement.csv", (req, res) => {
  const account = getAccount(req.params.accountId, req.userId);
  if (!account) {
    return res.status(404).json({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" } });
  }

  const safeName = account.accountName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
  const filename = `finflow-${safeName}-statement-${new Date().toISOString().slice(0, 10)}.csv`;
  let runningBalance = account.balance;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  function* rows() {
    yield csvRow(["Date", "Description", "Category", "Debit (INR)", "Credit (INR)", "Balance After (INR)", "Status"]);
    for (const row of iterateTransactions({ userId: req.userId, accountId: account.id })) {
      const balanceAfter = runningBalance;
      const isDebit = row.from_account_id === account.id;
      const isCredit = row.to_account_id === account.id;
      const affectsBalance = row.status === "completed";
      const description = isCredit
        ? row.from_username === row.to_username
          ? `From ${row.from_account_name}`
          : `From ${row.from_name} (@${row.from_username})`
        : row.from_username === row.to_username
          ? `To ${row.to_account_name}`
          : `To ${row.to_name} (@${row.to_username})`;

      yield csvRow([
        row.created_at,
        description,
        row.category,
        isDebit && affectsBalance ? (row.amount / 100).toFixed(2) : "",
        isCredit && affectsBalance ? (row.amount / 100).toFixed(2) : "",
        (balanceAfter / 100).toFixed(2),
        row.status,
      ]);

      if (affectsBalance) {
        if (isDebit) runningBalance += row.amount;
        if (isCredit) runningBalance -= row.amount;
      }
    }
  }

  Readable.from(rows()).on("error", (err) => res.destroy(err)).pipe(res);
});

router.get("/", (req, res) => {
  res.json(listTransactions(transactionFiltersFromQuery(req)));
});

router.patch("/:id/category", (req, res) => {
  const { category } = req.body ?? {};
  if (!isValidBudgetCategoryName(category)) {
    return res.status(400).json({
      error: { code: "INVALID_CATEGORY", message: "category must be a valid budgeting category name" },
    });
  }

  const transaction = updateTransactionCategory(req.userId, req.params.id, category);
  if (!transaction) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  res.json(transaction);
});

// General edit — lets a user categorize and annotate a transaction after the
// fact (either field is optional, so this also covers "just add a note").
router.patch("/:id", (req, res) => {
  const { category, note } = req.body ?? {};
  if (category !== undefined && !isValidBudgetCategoryName(category)) {
    return res.status(400).json({
      error: { code: "INVALID_CATEGORY", message: "category must be a valid budgeting category name" },
    });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be a string" } });
  }
  if (typeof note === "string" && note.length > 280) {
    return res.status(400).json({ error: { code: "INVALID_NOTE", message: "note must be 280 characters or fewer" } });
  }

  const transaction = updateTransaction(req.userId, req.params.id, { category, note });
  if (!transaction) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  res.json(transaction);
});

router.get("/:id", (req, res) => {
  const transaction = getTransaction(req.params.id, req.userId);
  if (!transaction) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  res.json(transaction);
});

export default router;
