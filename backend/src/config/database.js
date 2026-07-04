import { randomInt, randomUUID } from "crypto";
import { pool, dbGet, dbAll, dbRun, withTransaction } from "./db.js";

export const BUDGET_CATEGORIES = ["food", "transport", "shopping", "bills"];
const BUDGET_CATEGORY_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/;
const SCHEMA_MIGRATION_LOCK_ID = 803724521;
const schemaClient = await pool.connect();

// A single reusable helper that produces the "2026-07-04T10:15:30.123Z"
// timestamp shape used throughout the API and UI.
try {
  await schemaClient.query("SELECT pg_advisory_lock($1)", [SCHEMA_MIGRATION_LOCK_ID]);

  await schemaClient.query(`
  CREATE OR REPLACE FUNCTION iso_now() RETURNS TEXT AS $$
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  $$ LANGUAGE SQL VOLATILE;
`);

  await schemaClient.query(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    upi_pin_hash TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT iso_now()
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_name TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at TEXT NOT NULL DEFAULT iso_now()
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
    idempotency_key TEXT UNIQUE,
    from_account_id TEXT NOT NULL REFERENCES accounts(id),
    to_account_id TEXT NOT NULL REFERENCES accounts(id),
    category TEXT NOT NULL DEFAULT 'other',
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT iso_now()
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL CHECK (monthly_limit >= 0),
    threshold_percent INTEGER NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 100),
    created_at TEXT NOT NULL DEFAULT iso_now(),
    updated_at TEXT NOT NULL DEFAULT iso_now(),
    UNIQUE(user_id, category)
  );

  CREATE TABLE IF NOT EXISTS budget_deleted_presets (
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    PRIMARY KEY (user_id, category)
  );

  CREATE TABLE IF NOT EXISTS transfer_attempts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    attempted_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS failed_pin_attempts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    attempted_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_initiator ON transactions(initiated_by_user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_account_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_attempts_user ON transfer_attempts(user_id, attempted_at);
  CREATE INDEX IF NOT EXISTS idx_failed_pin_attempts_user ON failed_pin_attempts(user_id, attempted_at);
`);
// The CHECK (balance >= 0) column constraint blocks overdrafts at the database
// layer even if a bug or race reaches past the route/service validation.

// Postgres supports "ADD COLUMN IF NOT EXISTS" natively, so these migration
// statements are safe to repeat on every boot.
  await schemaClient.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS upi_pin_hash TEXT;
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_number TEXT;
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_auto_mandate INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_qr_payment INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_number ON transactions(reference_number);
`);

// If a database was created/migrated before these tables used SERIAL, the
// backing sequences can lag behind existing rows. Repair them on boot so the
// next insert never reuses an id and trips a primary-key conflict.
  await schemaClient.query(`
  SELECT setval(pg_get_serial_sequence('transfer_attempts', 'id'), COALESCE((SELECT MAX(id) FROM transfer_attempts), 0) + 1, false);
  SELECT setval(pg_get_serial_sequence('failed_pin_attempts', 'id'), COALESCE((SELECT MAX(id) FROM failed_pin_attempts), 0) + 1, false);
`);
} finally {
  try {
    await schemaClient.query("SELECT pg_advisory_unlock($1)", [SCHEMA_MIGRATION_LOCK_ID]);
  } finally {
    schemaClient.release();
  }
}

// A short 6-digit reference number shown in the UI alongside every
// transaction, distinct from the internal UUID `id`. Retries on the rare
// collision against the unique index above.
export async function generateReferenceNumber() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(randomInt(100000, 1000000));
    const existing = await dbGet("SELECT 1 FROM transactions WHERE reference_number = ?", candidate);
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique transaction reference number");
}

// Backfill reference numbers for transactions that existed before this
// column did — otherwise every pre-migration row would show a blank
// reference in the UI forever.
{
  const legacyTransactions = await dbAll("SELECT id FROM transactions WHERE reference_number IS NULL");
  if (legacyTransactions.length > 0) {
    await withTransaction(async (tx) => {
      for (const row of legacyTransactions) {
        await tx.run("UPDATE transactions SET reference_number = @referenceNumber WHERE id = @id", {
          id: row.id,
          referenceNumber: await generateReferenceNumber(),
        });
      }
    });
  }
}

// ---- row -> API JSON shape ----

function toUserJSON(row) {
  if (!row) return row;
  return { id: row.id, username: row.username, email: row.email, name: row.name, createdAt: row.created_at };
}

function toAccountJSON(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    accountName: row.account_name,
    balance: row.balance,
    createdAt: row.created_at,
  };
}

function toTransactionJSON(row) {
  if (!row) return row;
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    idempotencyKey: row.idempotency_key,
    fromAccountId: row.from_account_id,
    fromAccountName: row.from_account_name,
    fromUsername: row.from_username,
    fromName: row.from_name,
    toAccountId: row.to_account_id,
    toAccountName: row.to_account_name,
    toUsername: row.to_username,
    toName: row.to_name,
    category: row.category,
    note: row.note,
    amount: row.amount,
    status: row.status,
    failureReason: row.failure_reason,
    isAutoMandate: Boolean(row.is_auto_mandate),
    isQrPayment: Boolean(row.is_qr_payment),
    createdAt: row.created_at,
  };
}

function toBudgetJSON(row) {
  if (!row) return row;
  return {
    id: row.id,
    category: row.category,
    monthlyLimit: row.monthly_limit,
    spent: row.spent,
    remaining: row.monthly_limit - row.spent,
    utilizationPercent: row.monthly_limit === 0 ? (row.spent > 0 ? 999 : 0) : Math.min(Math.round((row.spent / row.monthly_limit) * 100), 999),
    thresholdPercent: row.threshold_percent,
    status:
      row.spent > row.monthly_limit
        ? "exceeded"
        : row.monthly_limit > 0 && row.spent >= Math.round((row.monthly_limit * row.threshold_percent) / 100)
          ? "warning"
          : "healthy",
    monthKey: row.month_key,
  };
}

const TRANSACTION_SELECT = `
  SELECT
    t.*,
    fa.account_name AS from_account_name, fu.username AS from_username, fu.name AS from_name,
    ta.account_name AS to_account_name, tu.username AS to_username, tu.name AS to_name
  FROM transactions t
  JOIN accounts fa ON fa.id = t.from_account_id
  JOIN users fu ON fu.id = fa.user_id
  JOIN accounts ta ON ta.id = t.to_account_id
  JOIN users tu ON tu.id = ta.user_id
`;

// ---- users ----

const INSERT_USER_SQL = "INSERT INTO users (id, username, email, password_hash, upi_pin_hash, name) VALUES (?, ?, ?, ?, ?, ?)";
const GET_USER_BY_EMAIL_SQL = "SELECT * FROM users WHERE email = ?";
const GET_USER_BY_USERNAME_SQL = "SELECT * FROM users WHERE username = ?";
const GET_USER_BY_ID_SQL = "SELECT * FROM users WHERE id = ?";
const INSERT_ACCOUNT_SQL = "INSERT INTO accounts (id, user_id, account_name, balance) VALUES (?, ?, ?, ?)";

export async function findUserByEmail(email) {
  return dbGet(GET_USER_BY_EMAIL_SQL, email);
}

export async function findUserByUsername(username) {
  return dbGet(GET_USER_BY_USERNAME_SQL, username);
}

export async function getUserById(id) {
  return toUserJSON(await dbGet(GET_USER_BY_ID_SQL, id));
}

export async function getUserRawById(id) {
  return dbGet(GET_USER_BY_ID_SQL, id);
}

const SET_USER_PIN_SQL = "UPDATE users SET upi_pin_hash = ? WHERE id = ?";

export async function setUserPin(userId, upiPinHash) {
  await dbRun(SET_USER_PIN_SQL, upiPinHash, userId);
}

// Includes the requesting user in results (labeled by the caller) so
// transfers between your own accounts stay reachable through the same
// username-search flow used for sending to other people.
export async function searchUsers(query, requestingUserId) {
  const like = `%${query}%`;
  return dbAll(
    `SELECT id, username, name, email FROM users
     WHERE id != ? AND (username LIKE ? OR name LIKE ? OR email LIKE ?)
     ORDER BY (CASE WHEN username LIKE ? THEN 0 ELSE 1 END), username ASC
     LIMIT 8`,
    requestingUserId,
    like,
    like,
    like,
    `${query}%`
  );
}

// Creates the user and seeds two starter accounts (Checking/Savings) in one
// atomic transaction, so a crash mid-signup never leaves a user with no accounts.
export async function createUser({ username, email, passwordHash, upiPinHash, name }) {
  const id = randomUUID();
  const user = await withTransaction(async (tx) => {
    await tx.run(INSERT_USER_SQL, id, username, email, passwordHash, upiPinHash, name);
    await tx.run(INSERT_ACCOUNT_SQL, randomUUID(), id, "Checking", 100000);
    await tx.run(INSERT_ACCOUNT_SQL, randomUUID(), id, "Savings", 50000);
    return tx.get(GET_USER_BY_ID_SQL, id);
  });
  return toUserJSON(user);
}

// ---- accounts ----

const GET_ACCOUNT_RAW_SQL = "SELECT * FROM accounts WHERE id = ?";
const LIST_ACCOUNTS_BY_USER_SQL = `
  SELECT * FROM accounts
  WHERE user_id = ?
  ORDER BY created_at ASC, account_name ASC, id ASC
`;

// Backed by Postgres (not an in-memory Map) so the limit survives a server
// restart and stays correct across multiple backend instances sharing the
// same database — an in-process counter would silently reset or under-count
// in either case.
export async function checkTransferRateLimit(userId, windowMs, maxCount) {
  return withTransaction(async (tx) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    await tx.run("DELETE FROM transfer_attempts WHERE user_id = @userId AND attempted_at < @cutoff", { userId, cutoff });
    const { count } = await tx.get(
      "SELECT COUNT(*) AS count FROM transfer_attempts WHERE user_id = @userId AND attempted_at >= @cutoff",
      { userId, cutoff }
    );
    if (Number(count) >= maxCount) return false;
    await tx.run("INSERT INTO transfer_attempts (user_id, attempted_at) VALUES (@userId, @now)", { userId, now });
    return true;
  });
}

// ---- PIN lockout ----
// Every wrong-PIN attempt (on any PIN-gated action — transfer, self-transfer,
// balance reveal, recurring setup) is recorded here; a correct PIN clears the
// whole streak. checkPinAuthorization (services/auth.js) is what actually
// decides when this adds up to a lockout.
export async function recordFailedPinAttempt(userId) {
  await dbRun("INSERT INTO failed_pin_attempts (user_id, attempted_at) VALUES (?, ?)", userId, Date.now());
}

export async function listFailedPinAttempts(userId) {
  const rows = await dbAll("SELECT attempted_at FROM failed_pin_attempts WHERE user_id = ? ORDER BY attempted_at DESC", userId);
  return rows.map((row) => Number(row.attempted_at));
}

export async function clearFailedPinAttempts(userId) {
  await dbRun("DELETE FROM failed_pin_attempts WHERE user_id = ?", userId);
}

export function isValidBudgetCategoryName(category) {
  return typeof category === "string" && BUDGET_CATEGORY_NAME_RE.test(category.trim());
}

export function normalizeBudgetCategory(category) {
  if (!isValidBudgetCategoryName(category)) return "other";
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function listBudgetCategories(userId) {
  if (!userId) return [...BUDGET_CATEGORIES];
  const deletedRows = await dbAll("SELECT category FROM budget_deleted_presets WHERE user_id = ?", userId);
  const deletedPresets = new Set(deletedRows.map((row) => row.category));
  const activePresets = BUDGET_CATEGORIES.filter((category) => !deletedPresets.has(category));
  const customRows = await dbAll("SELECT DISTINCT category FROM budgets WHERE user_id = ? ORDER BY category ASC", userId);
  const customCategories = customRows.map((row) => row.category).filter((category) => !BUDGET_CATEGORIES.includes(category));
  return [...activePresets, ...customCategories];
}

export async function listAccounts(userId) {
  const rows = await dbAll(LIST_ACCOUNTS_BY_USER_SQL, userId);
  return rows.map(toAccountJSON);
}

export async function createAccount({ userId, accountName, balance = 0 }) {
  const id = randomUUID();
  await dbRun(INSERT_ACCOUNT_SQL, id, userId, accountName, balance);
  return toAccountJSON(await dbGet(GET_ACCOUNT_RAW_SQL, id));
}

export async function getAccount(id, userId) {
  const row = await dbGet(GET_ACCOUNT_RAW_SQL, id);
  if (!row || row.user_id !== userId) return null;
  return toAccountJSON(row);
}

// Month boundaries are computed in IST (Asia/Kolkata, fixed UTC+5:30, no
// DST) so budgets reset at local midnight on the 1st, then converted back to
// UTC ISO strings to compare against created_at (stored in UTC).
const LIST_BUDGET_ROWS_SQL = `
  WITH month_bounds AS (
    SELECT
      to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month_key,
      to_char(
        (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS month_start,
      to_char(
        ((date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 month') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS month_end
  )
  SELECT
    b.*,
    mb.month_key,
    COALESCE(SUM(
      CASE
        WHEN t.status = 'completed'
         AND fa.user_id = b.user_id
         AND ta.user_id != fa.user_id
         AND t.category = b.category
         AND t.created_at >= mb.month_start
         AND t.created_at < mb.month_end
        THEN t.amount
        ELSE 0
      END
    ), 0) AS spent
  FROM budgets b
  CROSS JOIN month_bounds mb
  LEFT JOIN transactions t ON t.initiated_by_user_id = b.user_id
  LEFT JOIN accounts fa ON fa.id = t.from_account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  WHERE b.user_id = ?
  GROUP BY b.id, mb.month_key
  ORDER BY b.category ASC
`;
const UPSERT_BUDGET_SQL = `
  INSERT INTO budgets (id, user_id, category, monthly_limit, threshold_percent)
  VALUES (@id, @userId, @category, @monthlyLimit, @thresholdPercent)
  ON CONFLICT(user_id, category) DO UPDATE SET
    monthly_limit = excluded.monthly_limit,
    threshold_percent = excluded.threshold_percent,
    updated_at = iso_now()
`;

export async function listBudgets(userId) {
  const rows = await dbAll(LIST_BUDGET_ROWS_SQL, userId);
  return rows.map((row) => toBudgetJSON({ ...row, spent: Number(row.spent) }));
}

export async function upsertBudgets(userId, budgets) {
  await withTransaction(async (tx) => {
    for (const budget of budgets) {
      const normalizedCategory = normalizeBudgetCategory(budget.category);
      await tx.run(UPSERT_BUDGET_SQL, {
        id: randomUUID(),
        userId,
        category: normalizedCategory,
        monthlyLimit: budget.monthlyLimit,
        thresholdPercent: budget.thresholdPercent ?? 80,
      });
      await tx.run("DELETE FROM budget_deleted_presets WHERE user_id = ? AND category = ?", userId, normalizedCategory);
    }
  });
  return listBudgets(userId);
}

const UPDATE_TRANSACTION_CATEGORY_SQL = "UPDATE transactions SET category = @category WHERE id = @id AND initiated_by_user_id = @userId";
const UPDATE_TRANSACTION_NOTE_SQL = "UPDATE transactions SET note = @note WHERE id = @id AND initiated_by_user_id = @userId";
const UPDATE_TRANSACTION_CATEGORY_AND_NOTE_SQL =
  "UPDATE transactions SET category = @category, note = @note WHERE id = @id AND initiated_by_user_id = @userId";

export async function updateTransactionCategory(userId, transactionId, category) {
  const normalizedCategory = normalizeBudgetCategory(category);
  const result = await dbRun(UPDATE_TRANSACTION_CATEGORY_SQL, { id: transactionId, userId, category: normalizedCategory });
  if (result.changes === 0) return null;
  return getTransaction(transactionId, userId);
}

// Edits a transaction's category and/or note (a free-text description you can
// attach after the fact — useful for "other" spends or just annotating what
// something was for). Either field can be omitted to leave it unchanged.
export async function updateTransaction(userId, transactionId, { category, note }) {
  const hasCategory = category !== undefined;
  const hasNote = note !== undefined;
  const normalizedNote = hasNote ? (typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null) : undefined;

  let result;
  if (hasCategory && hasNote) {
    result = await dbRun(UPDATE_TRANSACTION_CATEGORY_AND_NOTE_SQL, {
      id: transactionId,
      userId,
      category: normalizeBudgetCategory(category),
      note: normalizedNote,
    });
  } else if (hasCategory) {
    result = await dbRun(UPDATE_TRANSACTION_CATEGORY_SQL, { id: transactionId, userId, category: normalizeBudgetCategory(category) });
  } else if (hasNote) {
    result = await dbRun(UPDATE_TRANSACTION_NOTE_SQL, { id: transactionId, userId, note: normalizedNote });
  } else {
    return getTransaction(transactionId, userId);
  }

  if (result.changes === 0) return null;
  return getTransaction(transactionId, userId);
}

export async function deleteBudgetCategory(userId, category) {
  const normalizedCategory = normalizeBudgetCategory(category);
  const isPreset = BUDGET_CATEGORIES.includes(normalizedCategory);
  return withTransaction(async (tx) => {
    const result = await tx.run("DELETE FROM budgets WHERE user_id = ? AND category = ?", userId, normalizedCategory);
    if (result.changes > 0 && normalizedCategory !== "other") {
      await tx.run("UPDATE transactions SET category = 'other' WHERE initiated_by_user_id = ? AND category = ?", userId, normalizedCategory);
    }
    // Presets are otherwise hardcoded into every user's category list, so
    // deleting one only sticks if we also remember it was explicitly removed.
    if (isPreset) {
      await tx.run(
        "INSERT INTO budget_deleted_presets (user_id, category) VALUES (?, ?) ON CONFLICT (user_id, category) DO NOTHING",
        userId,
        normalizedCategory
      );
    }
    return result.changes > 0 || isPreset;
  });
}

// ---- transactions / transfers ----

const DEBIT_ACCOUNT_SQL = "UPDATE accounts SET balance = balance - @amount WHERE id = @accountId AND balance >= @amount";
const CREDIT_ACCOUNT_SQL = "UPDATE accounts SET balance = balance + @amount WHERE id = @accountId";
const INSERT_TRANSACTION_SQL = `
  INSERT INTO transactions (id, reference_number, initiated_by_user_id, idempotency_key, from_account_id, to_account_id, category, amount, status, failure_reason, note, is_auto_mandate, is_qr_payment)
  VALUES (@id, @referenceNumber, @userId, @idempotencyKey, @fromAccountId, @toAccountId, @category, @amount, @status, @failureReason, @note, @isAutoMandate, @isQrPayment)
`;
const GET_TRANSACTION_RAW_SQL = `${TRANSACTION_SELECT} WHERE t.id = ?`;
const GET_TRANSACTION_BY_IDEMPOTENCY_KEY_SQL = `${TRANSACTION_SELECT} WHERE t.idempotency_key = ? AND t.initiated_by_user_id = ?`;

class TransferError extends Error {
  constructor(status, code, message, transaction = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.transaction = transaction;
  }
}

function insufficientFundsError(transaction) {
  return new TransferError(422, "INSUFFICIENT_FUNDS", "Source account has insufficient funds", toTransactionJSON(transaction));
}

function assertSameIdempotentTransfer(existing, { fromAccountId, toUsername, amount, category }) {
  if (
    existing.from_account_id !== fromAccountId ||
    existing.to_username !== toUsername ||
    existing.amount !== amount ||
    existing.category !== category
  ) {
    throw new TransferError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key has already been used for a different transfer");
  }
}

// Resolves which account receives the money for a given recipient username.
// Transfers to another person land in their primary (earliest-created) account.
// A "transfer to yourself" resolves to any other account you own, since you
// can't send money into the same account you're sending it from.
async function resolveDestinationAccountId(tx, userId, fromAccountId, toUsername) {
  const recipient = await tx.get(GET_USER_BY_USERNAME_SQL, toUsername);
  if (!recipient) {
    throw new TransferError(404, "RECIPIENT_NOT_FOUND", `No user found with username "${toUsername}"`);
  }
  if (recipient.id === userId) {
    throw new TransferError(400, "SELF_TRANSFER_BLOCKED", "Transfers to your own username are not allowed");
  }
  const recipientAccounts = await tx.all(LIST_ACCOUNTS_BY_USER_SQL, recipient.id);
  if (recipientAccounts.length === 0) {
    throw new TransferError(404, "RECIPIENT_NOT_FOUND", `${toUsername} has no accounts to receive funds`);
  }
  return recipientAccounts[0].id;
}

// Runs as a single Postgres transaction: resolves the recipient, validates
// ownership and funds, and applies the debit/credit atomically so a crash or
// concurrent request can never leave balances or history in a partial state.
// A failed (insufficient-funds) attempt still commits as a history row — only
// throwing here would roll back that audit record along with everything else.
// The conditional `WHERE balance >= @amount` on the debit (not just the CHECK
// constraint) is what actually prevents a race between two concurrent debits
// on the same account: Postgres row-locks the account row on UPDATE, so a
// second concurrent debit blocks until the first commits, then re-evaluates
// this WHERE clause against the now-updated balance.
async function transferTxn({ id, userId, idempotencyKey, fromAccountId, toUsername, amount, category, note, isAutoMandate, isQrPayment }) {
  return withTransaction(async (tx) => {
    const referenceNumber = await generateReferenceNumber();
    const from = await tx.get(GET_ACCOUNT_RAW_SQL, fromAccountId);
    if (!from || from.user_id !== userId) {
      throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
    }

    const toAccountId = await resolveDestinationAccountId(tx, userId, fromAccountId, toUsername);

    const insertFailed = () =>
      tx.run(INSERT_TRANSACTION_SQL, {
        id,
        referenceNumber,
        userId,
        idempotencyKey: idempotencyKey ?? null,
        fromAccountId,
        toAccountId,
        category,
        amount,
        status: "failed",
        failureReason: "insufficient_funds",
        note,
        isAutoMandate: isAutoMandate ? 1 : 0,
        isQrPayment: isQrPayment ? 1 : 0,
      });

    if (from.balance < amount) {
      await insertFailed();
      return tx.get(GET_TRANSACTION_RAW_SQL, id);
    }

    const debit = await tx.run(DEBIT_ACCOUNT_SQL, { amount, accountId: fromAccountId });
    if (debit.changes !== 1) {
      await insertFailed();
      return tx.get(GET_TRANSACTION_RAW_SQL, id);
    }

    const credit = await tx.run(CREDIT_ACCOUNT_SQL, { amount, accountId: toAccountId });
    if (credit.changes !== 1) {
      throw new TransferError(404, "RECIPIENT_NOT_FOUND", "Recipient account is no longer available");
    }

    await tx.run(INSERT_TRANSACTION_SQL, {
      id,
      referenceNumber,
      userId,
      idempotencyKey: idempotencyKey ?? null,
      fromAccountId,
      toAccountId,
      category,
      amount,
      status: "completed",
      failureReason: null,
      note,
      isAutoMandate: isAutoMandate ? 1 : 0,
      isQrPayment: isQrPayment ? 1 : 0,
    });

    return tx.get(GET_TRANSACTION_RAW_SQL, id);
  });
}

export async function transfer({ userId, fromAccountId, toUsername, amount, idempotencyKey, category, note, isAutoMandate, isQrPayment }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TransferError(400, "INVALID_AMOUNT", "amount must be a positive integer (cents)");
  }
  if (typeof fromAccountId !== "string" || typeof toUsername !== "string" || toUsername.trim().length === 0) {
    throw new TransferError(400, "INVALID_ACCOUNT", "fromAccountId and toUsername are required");
  }

  const normalizedToUsername = toUsername.trim().toLowerCase();
  const normalizedCategory = normalizeBudgetCategory(category);
  const normalizedNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null;

  if (idempotencyKey) {
    const existing = await dbGet(GET_TRANSACTION_BY_IDEMPOTENCY_KEY_SQL, idempotencyKey, userId);
    if (existing) {
      assertSameIdempotentTransfer(existing, {
        fromAccountId,
        toUsername: normalizedToUsername,
        amount,
        category: normalizedCategory,
      });
      if (existing.status === "failed") throw insufficientFundsError(existing);
      return { transaction: toTransactionJSON(existing), replayed: true };
    }
  }

  try {
    const transaction = await transferTxn({
      id: randomUUID(),
      userId,
      idempotencyKey,
      fromAccountId,
      toUsername: normalizedToUsername,
      category: normalizedCategory,
      amount,
      note: normalizedNote,
      isAutoMandate: Boolean(isAutoMandate),
      isQrPayment: Boolean(isQrPayment),
    });
    if (transaction.status === "failed") {
      throw insufficientFundsError(transaction);
    }
    return { transaction: toTransactionJSON(transaction), replayed: false };
  } catch (err) {
    if (err instanceof TransferError) throw err;
    // Postgres's unique_violation code — the race this catches is two
    // concurrent requests with the same idempotency key both missing the
    // pre-check above and racing to insert; the loser lands here instead.
    if (err.code === "23505") {
      const existing = await dbGet(GET_TRANSACTION_BY_IDEMPOTENCY_KEY_SQL, idempotencyKey, userId);
      if (existing) {
        assertSameIdempotentTransfer(existing, {
          fromAccountId,
          toUsername: normalizedToUsername,
          amount,
          category: normalizedCategory,
        });
        if (existing.status === "failed") throw insufficientFundsError(existing);
        return { transaction: toTransactionJSON(existing), replayed: true };
      }
    }
    throw err;
  }
}

// Moves money between two accounts owned by the same user (e.g. Savings ->
// Checking). Tagged with the fixed "transfer" category, which the budgets
// query already excludes from "spent" (it only counts money that left the
// user's own accounts) — so internal moves never distort a budget.
const OWN_ACCOUNT_TRANSFER_CATEGORY = "transfer";

async function ownAccountTransferTxn({ id, userId, idempotencyKey, fromAccountId, toAccountId, amount, note }) {
  return withTransaction(async (tx) => {
    const referenceNumber = await generateReferenceNumber();
    const from = await tx.get(GET_ACCOUNT_RAW_SQL, fromAccountId);
    if (!from || from.user_id !== userId) {
      throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
    }
    const to = await tx.get(GET_ACCOUNT_RAW_SQL, toAccountId);
    if (!to || to.user_id !== userId) {
      throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${toAccountId} not found`);
    }

    const insertFailed = () =>
      tx.run(INSERT_TRANSACTION_SQL, {
        id,
        referenceNumber,
        userId,
        idempotencyKey: idempotencyKey ?? null,
        fromAccountId,
        toAccountId,
        category: OWN_ACCOUNT_TRANSFER_CATEGORY,
        amount,
        status: "failed",
        failureReason: "insufficient_funds",
        note,
        isAutoMandate: 0,
        isQrPayment: 0,
      });

    if (from.balance < amount) {
      await insertFailed();
      return tx.get(GET_TRANSACTION_RAW_SQL, id);
    }

    const debit = await tx.run(DEBIT_ACCOUNT_SQL, { amount, accountId: fromAccountId });
    if (debit.changes !== 1) {
      await insertFailed();
      return tx.get(GET_TRANSACTION_RAW_SQL, id);
    }

    await tx.run(CREDIT_ACCOUNT_SQL, { amount, accountId: toAccountId });

    await tx.run(INSERT_TRANSACTION_SQL, {
      id,
      referenceNumber,
      userId,
      idempotencyKey: idempotencyKey ?? null,
      fromAccountId,
      toAccountId,
      category: OWN_ACCOUNT_TRANSFER_CATEGORY,
      amount,
      status: "completed",
      failureReason: null,
      note,
      isAutoMandate: 0,
      isQrPayment: 0,
    });

    return tx.get(GET_TRANSACTION_RAW_SQL, id);
  });
}

export async function transferToOwnAccount({ userId, fromAccountId, toAccountId, amount, idempotencyKey, note }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TransferError(400, "INVALID_AMOUNT", "amount must be a positive integer (cents)");
  }
  if (typeof fromAccountId !== "string" || typeof toAccountId !== "string") {
    throw new TransferError(400, "INVALID_ACCOUNT", "fromAccountId and toAccountId are required");
  }
  if (fromAccountId === toAccountId) {
    throw new TransferError(400, "SAME_ACCOUNT", "Choose two different accounts to transfer between");
  }

  if (idempotencyKey) {
    const existing = await dbGet(GET_TRANSACTION_BY_IDEMPOTENCY_KEY_SQL, idempotencyKey, userId);
    if (existing) {
      if (existing.status === "failed") throw insufficientFundsError(existing);
      return { transaction: toTransactionJSON(existing), replayed: true };
    }
  }

  const normalizedNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null;

  try {
    const transaction = await ownAccountTransferTxn({
      id: randomUUID(),
      userId,
      idempotencyKey,
      fromAccountId,
      toAccountId,
      amount,
      note: normalizedNote,
    });
    if (transaction.status === "failed") {
      throw insufficientFundsError(transaction);
    }
    return { transaction: toTransactionJSON(transaction), replayed: false };
  } catch (err) {
    if (err instanceof TransferError) throw err;
    if (err.code === "23505") {
      const existing = await dbGet(GET_TRANSACTION_BY_IDEMPOTENCY_KEY_SQL, idempotencyKey, userId);
      if (existing) {
        if (existing.status === "failed") throw insufficientFundsError(existing);
        return { transaction: toTransactionJSON(existing), replayed: true };
      }
    }
    throw err;
  }
}

function buildTransactionFilterQuery({
  userId,
  accountId,
  search,
  category,
  dateFrom,
  dateTo,
  minAmount,
  maxAmount,
  direction,
  status,
  referenceId,
} = {}) {
  const owned = "(SELECT id FROM accounts WHERE user_id = @userId)";
  const clauses = [`(t.from_account_id IN ${owned} OR t.to_account_id IN ${owned})`];
  const params = { userId };

  if (accountId) {
    clauses.push("(t.from_account_id = @accountId OR t.to_account_id = @accountId)");
    params.accountId = accountId;
  }
  if (typeof search === "string" && search.trim()) {
    clauses.push(`(
      t.note LIKE @search OR
      t.category LIKE @search OR
      t.id LIKE @search OR
      t.reference_number LIKE @search OR
      fu.username LIKE @search OR tu.username LIKE @search OR
      fu.name LIKE @search OR tu.name LIKE @search OR
      fa.account_name LIKE @search OR ta.account_name LIKE @search
    )`);
    params.search = `%${search.trim()}%`;
  }
  if (typeof category === "string" && category.trim()) {
    clauses.push("t.category = @category");
    params.category = normalizeBudgetCategory(category);
  }
  if (typeof dateFrom === "string" && dateFrom.trim()) {
    clauses.push("t.created_at >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (typeof dateTo === "string" && dateTo.trim()) {
    clauses.push("t.created_at <= @dateTo");
    params.dateTo = dateTo;
  }
  if (Number.isFinite(minAmount)) {
    clauses.push("t.amount >= @minAmount");
    params.minAmount = minAmount;
  }
  if (Number.isFinite(maxAmount)) {
    clauses.push("t.amount <= @maxAmount");
    params.maxAmount = maxAmount;
  }
  // "Sent" = this user's account was the source; "Received" = money came in
  // from someone else's account (a self-transfer between your own accounts
  // isn't a "received" payment from another person).
  if (direction === "sent") {
    clauses.push(`t.from_account_id IN ${owned}`);
  } else if (direction === "received") {
    clauses.push(`t.to_account_id IN ${owned} AND t.from_account_id NOT IN ${owned}`);
  }
  if (status === "completed" || status === "failed") {
    clauses.push("t.status = @status");
    params.status = status;
  }
  if (typeof referenceId === "string" && referenceId.trim()) {
    clauses.push("(t.id LIKE @referenceId OR t.idempotency_key LIKE @referenceId OR t.reference_number LIKE @referenceId)");
    params.referenceId = `%${referenceId.trim()}%`;
  }

  return { where: clauses.join(" AND "), params };
}

// Filters are all optional and applied server-side so a large history never
// has to be shipped to the client just to narrow it down: `search` matches
// the note, category, counterparty username/name, or account name (acting as
// the closest thing this app has to a "merchant" match); the rest are plain
// range/equality filters over date, category, and amount.
//
// `limit`/`offset` are optional — omitting them preserves the original
// "fetch everything matching these filters" behavior relied on by callers
// that need the full set (CSV export, the dashboard's own client-side
// filtering, budget review queues), while the History page opts into paging
// through a potentially large ledger instead of rendering it all at once.
export async function listTransactions({ limit, offset, ...filters } = {}) {
  const { where, params } = buildTransactionFilterQuery(filters);
  let sql = `${TRANSACTION_SELECT} WHERE ${where} ORDER BY t.created_at DESC`;
  if (Number.isSafeInteger(limit) && limit > 0) {
    sql += " LIMIT @limit OFFSET @offset";
    params.limit = limit;
    params.offset = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
  }
  const rows = await dbAll(sql, params);
  return rows.map(toTransactionJSON);
}

// Total count of transactions matching the same filters `listTransactions`
// would apply, ignoring limit/offset — lets the History page show "Page X of
// Y" / disable "Next" without pulling every row over the wire just to count them.
export async function countTransactions(filters = {}) {
  const { where, params } = buildTransactionFilterQuery(filters);
  const row = await dbGet(
    `SELECT COUNT(*) AS count FROM transactions t
     JOIN accounts fa ON fa.id = t.from_account_id
     JOIN users fu ON fu.id = fa.user_id
     JOIN accounts ta ON ta.id = t.to_account_id
     JOIN users tu ON tu.id = ta.user_id
     WHERE ${where}`,
    params
  );
  return Number(row.count);
}

// CSV export streams consume this async generator. It pages through Postgres
// in bounded batches so large histories are never materialized as one array.
export async function* iterateTransactions(filters = {}, batchSize = 500) {
  const { where, params } = buildTransactionFilterQuery(filters);
  let offset = 0;
  const limit = Math.max(1, Math.min(Math.trunc(batchSize), 1000));

  while (true) {
    const rows = await dbAll(
      `${TRANSACTION_SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT @batchLimit OFFSET @batchOffset`,
      { ...params, batchLimit: limit, batchOffset: offset }
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      yield toTransactionJSON(row);
    }
    if (rows.length < limit) break;
    offset += rows.length;
  }
}

export async function getTransaction(id, userId) {
  const row = await dbGet(GET_TRANSACTION_RAW_SQL, id);
  if (!row) return null;
  const fromAccount = await dbGet(GET_ACCOUNT_RAW_SQL, row.from_account_id);
  const toAccount = await dbGet(GET_ACCOUNT_RAW_SQL, row.to_account_id);
  const owns = [fromAccount, toAccount].some((acc) => acc?.user_id === userId);
  if (!owns) return null;
  return toTransactionJSON(row);
}

export { TransferError };
export default pool;
