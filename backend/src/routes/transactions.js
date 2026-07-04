import { Router } from "express";
import { Readable } from "stream";
import {
  transfer,
  transferToOwnAccount,
  listTransactions,
  countTransactions,
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
import { asyncHandler } from "../services/asyncHandler.js";

const router = Router();
router.use(requireAuth);

const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const MAX_TRANSFER_AMOUNT = 50000000;
const TRANSFER_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSFER_RATE_LIMIT_COUNT = 8;

const enforceTransferRateLimit = asyncHandler(async (req, res, next) => {
  const allowed = await checkTransferRateLimit(req.userId, TRANSFER_RATE_LIMIT_WINDOW_MS, TRANSFER_RATE_LIMIT_COUNT);
  if (!allowed) {
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many transfer attempts. Please wait a moment and try again.",
      },
    });
  }
  next();
});

router.post(
  "/transfer",
  enforceTransferRateLimit,
  asyncHandler(async (req, res) => {
    const { fromAccountId, toUsername, amount, idempotencyKey, pin, category, note, isQrPayment } = req.body ?? {};

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
    const user = await getUserRawById(req.userId);
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    const authError = await checkPinAuthorization(user, pin);
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
      const { transaction, replayed } = await transfer({
        userId: req.userId,
        fromAccountId,
        toUsername: toUsername.trim().toLowerCase(),
        amount,
        idempotencyKey,
        category,
        note,
        isQrPayment: Boolean(isQrPayment),
      });
      res.status(replayed ? 200 : 201).json({
        transaction,
        replayed,
        accounts: await listAccounts(req.userId),
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
  })
);

router.post(
  "/self-transfer",
  enforceTransferRateLimit,
  asyncHandler(async (req, res) => {
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

    const user = await getUserRawById(req.userId);
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    const authError = await checkPinAuthorization(user, pin);
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
      const { transaction, replayed } = await transferToOwnAccount({
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
        accounts: await listAccounts(req.userId),
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
  })
);

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

const MAX_PAGE_SIZE = 200;

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells) {
  return `${cells.map(csvCell).join(",")}\n`;
}

function transactionDescription(row, currentUsername) {
  if (row.fromUsername === row.toUsername) return `${row.fromAccountName} -> ${row.toAccountName}`;
  return row.fromUsername === currentUsername
    ? `To ${row.toName} (@${row.toUsername})`
    : `From ${row.fromName} (@${row.fromUsername})`;
}

router.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const filters = transactionFiltersFromQuery(req);
    const filename = `finflow-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    const user = await getUserRawById(req.userId);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    async function* rows() {
      yield csvRow(["Date", "Description", "Category", "From", "To", "Amount (INR)", "Status", "Note"]);
      for await (const row of iterateTransactions(filters)) {
        yield csvRow([
          row.createdAt,
          transactionDescription(row, user?.username),
          row.category,
          `${row.fromName} (@${row.fromUsername})`,
          `${row.toName} (@${row.toUsername})`,
          (row.amount / 100).toFixed(2),
          row.status,
          row.note ?? "",
        ]);
      }
    }

    Readable.from(rows()).on("error", (err) => res.destroy(err)).pipe(res);
  })
);

router.get(
  "/accounts/:accountId/statement.csv",
  asyncHandler(async (req, res) => {
    const account = await getAccount(req.params.accountId, req.userId);
    if (!account) {
      return res.status(404).json({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" } });
    }

    const safeName = account.accountName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
    const filename = `finflow-${safeName}-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    let runningBalance = account.balance;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    async function* rows() {
      yield csvRow(["Date", "Description", "Category", "Debit (INR)", "Credit (INR)", "Balance After (INR)", "Status"]);
      for await (const row of iterateTransactions({ userId: req.userId, accountId: account.id })) {
        const balanceAfter = runningBalance;
        const isDebit = row.fromAccountId === account.id;
        const isCredit = row.toAccountId === account.id;
        const affectsBalance = row.status === "completed";
        const description = isCredit
          ? row.fromUsername === row.toUsername
            ? `From ${row.fromAccountName}`
            : `From ${row.fromName} (@${row.fromUsername})`
          : row.fromUsername === row.toUsername
            ? `To ${row.toAccountName}`
            : `To ${row.toName} (@${row.toUsername})`;

        yield csvRow([
          row.createdAt,
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
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = transactionFiltersFromQuery(req);
    const limitParam = numberParam(req.query.limit);

    // limit/offset are opt-in: omitting them keeps the original "everything
    // matching these filters" response the dashboard and budget review queue
    // rely on. Passing a limit (the History page's paged view) also gets an
    // X-Total-Count header instead of paying for a COUNT(*) on every request.
    if (limitParam === undefined) {
      return res.json(await listTransactions(filters));
    }

    const limit = Math.min(Math.max(Math.trunc(limitParam), 1), MAX_PAGE_SIZE);
    const offset = Math.max(Math.trunc(numberParam(req.query.offset) ?? 0), 0);
    const total = await countTransactions(filters);
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
    res.json(await listTransactions({ ...filters, limit, offset }));
  })
);

router.patch(
  "/:id/category",
  asyncHandler(async (req, res) => {
    const { category } = req.body ?? {};
    if (!isValidBudgetCategoryName(category)) {
      return res.status(400).json({
        error: { code: "INVALID_CATEGORY", message: "category must be a valid budgeting category name" },
      });
    }

    const transaction = await updateTransactionCategory(req.userId, req.params.id, category);
    if (!transaction) {
      return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
    }
    res.json(transaction);
  })
);

// General edit — lets a user categorize and annotate a transaction after the
// fact (either field is optional, so this also covers "just add a note").
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
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

    const transaction = await updateTransaction(req.userId, req.params.id, { category, note });
    if (!transaction) {
      return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
    }
    res.json(transaction);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const transaction = await getTransaction(req.params.id, req.userId);
    if (!transaction) {
      return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
    }
    res.json(transaction);
  })
);

export default router;
