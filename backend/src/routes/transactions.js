import { Router } from "express";
import {
  transfer,
  transferToOwnAccount,
  listTransactions,
  getTransaction,
  getUserRawById,
  listAccounts,
  TransferError,
  isValidBudgetCategoryName,
  updateTransactionCategory,
  updateTransaction,
} from "../config/database.js";
import { requireAuth, checkPinAuthorization } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const MAX_TRANSFER_AMOUNT = 50000000;
const TRANSFER_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSFER_RATE_LIMIT_COUNT = 8;
const transferAttemptsByUser = new Map();
function pruneAttempts(userId, now) {
  const attempts = transferAttemptsByUser.get(userId) ?? [];
  const activeAttempts = attempts.filter((timestamp) => now - timestamp < TRANSFER_RATE_LIMIT_WINDOW_MS);
  transferAttemptsByUser.set(userId, activeAttempts);
  return activeAttempts;
}

function enforceTransferRateLimit(req, res, next) {
  const now = Date.now();
  const attempts = pruneAttempts(req.userId, now);
  if (attempts.length >= TRANSFER_RATE_LIMIT_COUNT) {
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many transfer attempts. Please wait a moment and try again.",
      },
    });
  }
  attempts.push(now);
  transferAttemptsByUser.set(req.userId, attempts);
  next();
}

router.post("/transfer", enforceTransferRateLimit, (req, res) => {
  const { fromAccountId, toUsername, amount, idempotencyKey, pin, category } = req.body ?? {};

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
    return res.status(authError.status).json({ error: { code: authError.code, message: authError.message } });
  }

  try {
    const { transaction, replayed } = transfer({
      userId: req.userId,
      fromAccountId,
      toUsername: toUsername.trim().toLowerCase(),
      amount,
      idempotencyKey,
      category,
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
  const { fromAccountId, toAccountId, amount, idempotencyKey, pin } = req.body ?? {};

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
    return res.status(authError.status).json({ error: { code: authError.code, message: authError.message } });
  }

  try {
    const { transaction, replayed } = transferToOwnAccount({
      userId: req.userId,
      fromAccountId,
      toAccountId,
      amount,
      idempotencyKey,
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

router.get("/", (req, res) => {
  res.json(
    listTransactions({
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
    })
  );
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
