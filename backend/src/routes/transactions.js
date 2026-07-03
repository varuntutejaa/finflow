import { Router } from "express";
import { transfer, listTransactions, getTransaction, getUserRawById, listAccounts, TransferError } from "../config/database.js";
import { requireAuth, verifyPassword } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

const PIN_RE = /^\d{4}$/;
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
  const { fromAccountId, toUsername, amount, idempotencyKey, pin } = req.body ?? {};

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
  if (!user.upi_pin_hash) {
    return res
      .status(403)
      .json({ error: { code: "PIN_NOT_SET", message: "Set a UPI PIN before making transfers" } });
  }
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return res.status(400).json({ error: { code: "INVALID_PIN", message: "UPI PIN must be exactly 4 digits" } });
  }
  if (!verifyPassword(pin, user.upi_pin_hash)) {
    return res.status(401).json({ error: { code: "INCORRECT_PIN", message: "Incorrect UPI PIN" } });
  }

  try {
    const { transaction, replayed } = transfer({
      userId: req.userId,
      fromAccountId,
      toUsername: toUsername.trim().toLowerCase(),
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

router.get("/", (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  res.json(listTransactions({ userId: req.userId, accountId }));
});

router.get("/:id", (req, res) => {
  const transaction = getTransaction(req.params.id, req.userId);
  if (!transaction) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  res.json(transaction);
});

export default router;
