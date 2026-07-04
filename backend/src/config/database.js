import Database from "better-sqlite3";
import { randomInt, randomUUID } from "crypto";
import fs from "fs";
import path from "path";

export const BUDGET_CATEGORIES = ["food", "transport", "shopping", "bills"];
const BUDGET_CATEGORY_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/;

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "finflow.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    upi_pin_hash TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_name TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL CHECK (monthly_limit >= 0),
    threshold_percent INTEGER NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 100),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(user_id, category)
  );

  CREATE TABLE IF NOT EXISTS budget_deleted_presets (
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    PRIMARY KEY (user_id, category)
  );

  CREATE TABLE IF NOT EXISTS transfer_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    attempted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS failed_pin_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    attempted_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_initiator ON transactions(initiated_by_user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_account_id);
  CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_attempts_user ON transfer_attempts(user_id, attempted_at);
  CREATE INDEX IF NOT EXISTS idx_failed_pin_attempts_user ON failed_pin_attempts(user_id, attempted_at);

  CREATE TRIGGER IF NOT EXISTS accounts_balance_nonnegative_insert
  BEFORE INSERT ON accounts
  WHEN NEW.balance < 0
  BEGIN
    SELECT RAISE(ABORT, 'account balance cannot be negative');
  END;

  CREATE TRIGGER IF NOT EXISTS accounts_balance_nonnegative_update
  BEFORE UPDATE OF balance ON accounts
  WHEN NEW.balance < 0
  BEGIN
    SELECT RAISE(ABORT, 'account balance cannot be negative');
  END;
`);

// Migration for databases created before the UPI PIN feature existed —
// SQLite's CREATE TABLE IF NOT EXISTS above is a no-op on an already-created
// table, so older rows need the column added on. Accounts from before this
// migration have no PIN set and are blocked from transferring (PIN_NOT_SET)
// until they set one via POST /api/auth/pin.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("upi_pin_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN upi_pin_hash TEXT");
}

const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
if (!transactionColumns.includes("category")) {
  db.exec("ALTER TABLE transactions ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
}
if (!transactionColumns.includes("note")) {
  db.exec("ALTER TABLE transactions ADD COLUMN note TEXT");
}
if (!transactionColumns.includes("reference_number")) {
  db.exec("ALTER TABLE transactions ADD COLUMN reference_number TEXT");
}
if (!transactionColumns.includes("is_auto_mandate")) {
  db.exec("ALTER TABLE transactions ADD COLUMN is_auto_mandate INTEGER NOT NULL DEFAULT 0");
}

db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_number ON transactions(reference_number)");

// A short 6-digit reference number shown in the UI alongside every
// transaction, distinct from the internal UUID `id`. Retries on the rare
// collision against the unique index above.
const checkReferenceNumberStmt = db.prepare("SELECT 1 FROM transactions WHERE reference_number = ?");
export function generateReferenceNumber() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(randomInt(100000, 1000000));
    if (!checkReferenceNumberStmt.get(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique transaction reference number");
}

// Backfill reference numbers for transactions that existed before this
// column did — otherwise every pre-migration row would show a blank
// reference in the UI forever.
const legacyTransactionIds = db
  .prepare("SELECT id FROM transactions WHERE reference_number IS NULL")
  .all()
  .map((row) => row.id);
if (legacyTransactionIds.length > 0) {
  const backfillReferenceNumberStmt = db.prepare("UPDATE transactions SET reference_number = @referenceNumber WHERE id = @id");
  const backfillTxn = db.transaction((ids) => {
    for (const id of ids) {
      backfillReferenceNumberStmt.run({ id, referenceNumber: generateReferenceNumber() });
    }
  });
  backfillTxn(legacyTransactionIds);
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

const insertUserStmt = db.prepare(
  "INSERT INTO users (id, username, email, password_hash, upi_pin_hash, name) VALUES (?, ?, ?, ?, ?, ?)"
);
const getUserByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
const getUserByUsernameStmt = db.prepare("SELECT * FROM users WHERE username = ?");
const getUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const insertAccountStmt = db.prepare(
  "INSERT INTO accounts (id, user_id, account_name, balance) VALUES (?, ?, ?, ?)"
);

export function findUserByEmail(email) {
  return getUserByEmailStmt.get(email);
}

export function findUserByUsername(username) {
  return getUserByUsernameStmt.get(username);
}

export function getUserById(id) {
  return toUserJSON(getUserByIdStmt.get(id));
}

export function getUserRawById(id) {
  return getUserByIdStmt.get(id);
}

const setUserPinStmt = db.prepare("UPDATE users SET upi_pin_hash = ? WHERE id = ?");

export function setUserPin(userId, upiPinHash) {
  setUserPinStmt.run(upiPinHash, userId);
}

// Signup now collects a PIN up front, but accounts created before that
// change have no PIN set at all and would otherwise be locked out of every
// PIN-gated action. Takes the hashing function as a parameter instead of
// importing services/auth.js directly, since that module already imports
// from here (would otherwise be a circular import).
export function backfillMissingPins(hashPin, defaultPin) {
  const rows = db.prepare("SELECT id FROM users WHERE upi_pin_hash IS NULL").all();
  if (rows.length === 0) return 0;
  const hash = hashPin(defaultPin);
  const txn = db.transaction((ids) => {
    for (const id of ids) setUserPinStmt.run(hash, id);
  });
  txn(rows.map((r) => r.id));
  return rows.length;
}

// Includes the requesting user in results (labeled by the caller) so
// transfers between your own accounts stay reachable through the same
// username-search flow used for sending to other people.
export function searchUsers(query, requestingUserId) {
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT id, username, name, email FROM users
       WHERE id != ? AND (username LIKE ? OR name LIKE ? OR email LIKE ?)
       ORDER BY (CASE WHEN username LIKE ? THEN 0 ELSE 1 END), username ASC
       LIMIT 8`
    )
    .all(requestingUserId, like, like, like, `${query}%`);
}

// Creates the user and seeds two starter accounts (Checking/Savings) in one
// atomic transaction, so a crash mid-signup never leaves a user with no accounts.
const createUserTxn = db.transaction(({ id, username, email, passwordHash, upiPinHash, name }) => {
  insertUserStmt.run(id, username, email, passwordHash, upiPinHash, name);
  insertAccountStmt.run(randomUUID(), id, "Checking", 100000);
  insertAccountStmt.run(randomUUID(), id, "Savings", 50000);
  return getUserByIdStmt.get(id);
});

export function createUser({ username, email, passwordHash, upiPinHash, name }) {
  const user = createUserTxn({ id: randomUUID(), username, email, passwordHash, upiPinHash, name });
  return toUserJSON(user);
}

// ---- accounts ----

const getAccountRawStmt = db.prepare("SELECT * FROM accounts WHERE id = ?");
const listAccountsByUserStmt = db.prepare(
  "SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC"
);

const pruneTransferAttemptsStmt = db.prepare("DELETE FROM transfer_attempts WHERE user_id = @userId AND attempted_at < @cutoff");
const countTransferAttemptsStmt = db.prepare(
  "SELECT COUNT(*) AS count FROM transfer_attempts WHERE user_id = @userId AND attempted_at >= @cutoff"
);
const insertTransferAttemptStmt = db.prepare("INSERT INTO transfer_attempts (user_id, attempted_at) VALUES (@userId, @now)");

// Backed by SQLite (not an in-memory Map) so the limit survives a server
// restart and stays correct if this ever runs as more than one instance
// sharing the same database file — an in-process counter would silently
// reset or under-count in either case.
const recordTransferAttemptTxn = db.transaction((userId, windowMs, maxCount) => {
  const now = Date.now();
  const cutoff = now - windowMs;
  pruneTransferAttemptsStmt.run({ userId, cutoff });
  const { count } = countTransferAttemptsStmt.get({ userId, cutoff });
  if (count >= maxCount) return false;
  insertTransferAttemptStmt.run({ userId, now });
  return true;
});

export function checkTransferRateLimit(userId, windowMs, maxCount) {
  return recordTransferAttemptTxn(userId, windowMs, maxCount);
}

// ---- PIN lockout ----
// Every wrong-PIN attempt (on any PIN-gated action — transfer, self-transfer,
// balance reveal, recurring setup) is recorded here; a correct PIN clears the
// whole streak. checkPinAuthorization (services/auth.js) is what actually
// decides when this adds up to a lockout.
const insertFailedPinAttemptStmt = db.prepare("INSERT INTO failed_pin_attempts (user_id, attempted_at) VALUES (?, ?)");
const listFailedPinAttemptsStmt = db.prepare(
  "SELECT attempted_at FROM failed_pin_attempts WHERE user_id = ? ORDER BY attempted_at DESC"
);
const clearFailedPinAttemptsStmt = db.prepare("DELETE FROM failed_pin_attempts WHERE user_id = ?");

export function recordFailedPinAttempt(userId) {
  insertFailedPinAttemptStmt.run(userId, Date.now());
}

export function listFailedPinAttempts(userId) {
  return listFailedPinAttemptsStmt.all(userId).map((row) => row.attempted_at);
}

export function clearFailedPinAttempts(userId) {
  clearFailedPinAttemptsStmt.run(userId);
}

export function isValidBudgetCategoryName(category) {
  return typeof category === "string" && BUDGET_CATEGORY_NAME_RE.test(category.trim());
}

export function normalizeBudgetCategory(category) {
  if (!isValidBudgetCategoryName(category)) return "other";
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

const listDeletedPresetsStmt = db.prepare("SELECT category FROM budget_deleted_presets WHERE user_id = ?");

export function listBudgetCategories(userId) {
  if (!userId) return [...BUDGET_CATEGORIES];
  const deletedPresets = new Set(listDeletedPresetsStmt.all(userId).map((row) => row.category));
  const activePresets = BUDGET_CATEGORIES.filter((category) => !deletedPresets.has(category));
  const customCategories = db
    .prepare("SELECT DISTINCT category FROM budgets WHERE user_id = ? ORDER BY category ASC")
    .all(userId)
    .map((row) => row.category)
    .filter((category) => !BUDGET_CATEGORIES.includes(category));
  return [...activePresets, ...customCategories];
}

export function listAccounts(userId) {
  return listAccountsByUserStmt.all(userId).map(toAccountJSON);
}

export function createAccount({ userId, accountName, balance = 0 }) {
  const id = randomUUID();
  insertAccountStmt.run(id, userId, accountName, balance);
  return toAccountJSON(getAccountRawStmt.get(id));
}

export function getAccount(id, userId) {
  const row = getAccountRawStmt.get(id);
  if (!row || row.user_id !== userId) return null;
  return toAccountJSON(row);
}

export function listBudgets(userId) {
  return listBudgetRowsStmt.all(userId).map(toBudgetJSON);
}

const deleteDeletedPresetStmt = db.prepare(
  "DELETE FROM budget_deleted_presets WHERE user_id = ? AND category = ?"
);

export function upsertBudgets(userId, budgets) {
  const txn = db.transaction((items) => {
    for (const budget of items) {
      const normalizedCategory = normalizeBudgetCategory(budget.category);
      upsertBudgetStmt.run({
        id: randomUUID(),
        userId,
        category: normalizedCategory,
        monthlyLimit: budget.monthlyLimit,
        thresholdPercent: budget.thresholdPercent ?? 80,
      });
      deleteDeletedPresetStmt.run(userId, normalizedCategory);
    }
  });

  txn(budgets);
  return listBudgets(userId);
}

const updateTransactionCategoryStmt = db.prepare(
  "UPDATE transactions SET category = @category WHERE id = @id AND initiated_by_user_id = @userId"
);
const updateTransactionNoteStmt = db.prepare(
  "UPDATE transactions SET note = @note WHERE id = @id AND initiated_by_user_id = @userId"
);
const updateTransactionCategoryAndNoteStmt = db.prepare(
  "UPDATE transactions SET category = @category, note = @note WHERE id = @id AND initiated_by_user_id = @userId"
);

export function updateTransactionCategory(userId, transactionId, category) {
  const normalizedCategory = normalizeBudgetCategory(category);
  const result = updateTransactionCategoryStmt.run({ id: transactionId, userId, category: normalizedCategory });
  if (result.changes === 0) return null;
  return getTransaction(transactionId, userId);
}

// Edits a transaction's category and/or note (a free-text description you can
// attach after the fact — useful for "other" spends or just annotating what
// something was for). Either field can be omitted to leave it unchanged.
export function updateTransaction(userId, transactionId, { category, note }) {
  const hasCategory = category !== undefined;
  const hasNote = note !== undefined;
  const normalizedNote = hasNote ? (typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null) : undefined;

  let result;
  if (hasCategory && hasNote) {
    result = updateTransactionCategoryAndNoteStmt.run({
      id: transactionId,
      userId,
      category: normalizeBudgetCategory(category),
      note: normalizedNote,
    });
  } else if (hasCategory) {
    result = updateTransactionCategoryStmt.run({ id: transactionId, userId, category: normalizeBudgetCategory(category) });
  } else if (hasNote) {
    result = updateTransactionNoteStmt.run({ id: transactionId, userId, note: normalizedNote });
  } else {
    return getTransaction(transactionId, userId);
  }

  if (result.changes === 0) return null;
  return getTransaction(transactionId, userId);
}

const reassignOrphanedTransactionsStmt = db.prepare(
  "UPDATE transactions SET category = 'other' WHERE initiated_by_user_id = ? AND category = ?"
);

const insertDeletedPresetStmt = db.prepare(
  "INSERT OR IGNORE INTO budget_deleted_presets (user_id, category) VALUES (?, ?)"
);

export function deleteBudgetCategory(userId, category) {
  const normalizedCategory = normalizeBudgetCategory(category);
  const isPreset = BUDGET_CATEGORIES.includes(normalizedCategory);
  const txn = db.transaction(() => {
    const result = db
      .prepare("DELETE FROM budgets WHERE user_id = ? AND category = ?")
      .run(userId, normalizedCategory);
    if (result.changes > 0 && normalizedCategory !== "other") {
      reassignOrphanedTransactionsStmt.run(userId, normalizedCategory);
    }
    // Presets are otherwise hardcoded into every user's category list, so
    // deleting one only sticks if we also remember it was explicitly removed.
    if (isPreset) {
      insertDeletedPresetStmt.run(userId, normalizedCategory);
    }
    return result.changes > 0 || isPreset;
  });
  return txn();
}

// ---- transactions / transfers ----

const debitAccountStmt = db.prepare(
  "UPDATE accounts SET balance = balance - @amount WHERE id = @accountId AND balance >= @amount"
);
const creditAccountStmt = db.prepare(
  "UPDATE accounts SET balance = balance + @amount WHERE id = @accountId"
);
const insertTransactionStmt = db.prepare(`
  INSERT INTO transactions (id, reference_number, initiated_by_user_id, idempotency_key, from_account_id, to_account_id, category, amount, status, failure_reason, note, is_auto_mandate)
  VALUES (@id, @referenceNumber, @userId, @idempotencyKey, @fromAccountId, @toAccountId, @category, @amount, @status, @failureReason, @note, @isAutoMandate)
`);
const getTransactionRawStmt = db.prepare(`${TRANSACTION_SELECT} WHERE t.id = ?`);
const getTransactionByIdempotencyKeyStmt = db.prepare(
  `${TRANSACTION_SELECT} WHERE t.idempotency_key = ? AND t.initiated_by_user_id = ?`
);
const listBudgetRowsStmt = db.prepare(`
  WITH month_bounds AS (
    -- Month boundaries are computed in IST (UTC+5:30): shift 'now' into IST
    -- wall-clock numberspace, snap to the start of that month, then shift back
    -- to true UTC so the bounds compare correctly against created_at (UTC).
    SELECT
      strftime('%Y-%m', 'now', '+5 hours', '+30 minutes') AS month_key,
      strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now', '+5 hours', '+30 minutes', 'start of month', '-5 hours', '-30 minutes') AS month_start,
      strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now', '+5 hours', '+30 minutes', 'start of month', '+1 month', '-5 hours', '-30 minutes') AS month_end
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
  GROUP BY b.id
  ORDER BY b.category ASC
`);
const upsertBudgetStmt = db.prepare(`
  INSERT INTO budgets (id, user_id, category, monthly_limit, threshold_percent)
  VALUES (@id, @userId, @category, @monthlyLimit, @thresholdPercent)
  ON CONFLICT(user_id, category) DO UPDATE SET
    monthly_limit = excluded.monthly_limit,
    threshold_percent = excluded.threshold_percent,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
`);

class TransferError extends Error {
  constructor(status, code, message, transaction = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.transaction = transaction;
  }
}

function insufficientFundsError(transaction) {
  return new TransferError(
    422,
    "INSUFFICIENT_FUNDS",
    "Source account has insufficient funds",
    toTransactionJSON(transaction)
  );
}

function assertSameIdempotentTransfer(existing, { fromAccountId, toUsername, amount, category }) {
  if (
    existing.from_account_id !== fromAccountId ||
    existing.to_username !== toUsername ||
    existing.amount !== amount ||
    existing.category !== category
  ) {
    throw new TransferError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key has already been used for a different transfer"
    );
  }
}

// Resolves which account receives the money for a given recipient username.
// Transfers to another person land in their primary (earliest-created) account.
// A "transfer to yourself" resolves to any other account you own, since you
// can't send money into the same account you're sending it from.
function resolveDestinationAccountId(userId, fromAccountId, toUsername) {
  const recipient = getUserByUsernameStmt.get(toUsername);
  if (!recipient) {
    throw new TransferError(404, "RECIPIENT_NOT_FOUND", `No user found with username "${toUsername}"`);
  }
  const recipientAccounts = listAccountsByUserStmt.all(recipient.id);
  if (recipient.id === userId) {
    throw new TransferError(400, "SELF_TRANSFER_BLOCKED", "Transfers to your own username are not allowed");
  }
  if (recipientAccounts.length === 0) {
    throw new TransferError(404, "RECIPIENT_NOT_FOUND", `${toUsername} has no accounts to receive funds`);
  }
  return recipientAccounts[0].id;
}

// Runs as a single SQLite transaction: resolves the recipient, validates
// ownership and funds, and applies the debit/credit atomically so a crash or
// concurrent request can never leave balances or history in a partial state.
// A failed (insufficient-funds) attempt still commits as a history row — only
// throwing here would roll back that audit record along with everything else.
const transferTxn = db.transaction(
  ({ id, userId, idempotencyKey, fromAccountId, toUsername, amount, category, note, isAutoMandate }) => {
    const referenceNumber = generateReferenceNumber();
    const from = getAccountRawStmt.get(fromAccountId);
    if (!from || from.user_id !== userId) {
      throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
    }

    const toAccountId = resolveDestinationAccountId(userId, fromAccountId, toUsername);

    if (from.balance < amount) {
      insertTransactionStmt.run({
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
      });
      return getTransactionRawStmt.get(id);
    }

    const debit = debitAccountStmt.run({ amount, accountId: fromAccountId });
    if (debit.changes !== 1) {
      insertTransactionStmt.run({
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
      });
      return getTransactionRawStmt.get(id);
    }

    const credit = creditAccountStmt.run({ amount, accountId: toAccountId });
    if (credit.changes !== 1) {
      throw new TransferError(404, "RECIPIENT_NOT_FOUND", "Recipient account is no longer available");
    }

    insertTransactionStmt.run({
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
    });

    return getTransactionRawStmt.get(id);
  }
);

export function transfer({ userId, fromAccountId, toUsername, amount, idempotencyKey, category, note, isAutoMandate }) {
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
    const existing = getTransactionByIdempotencyKeyStmt.get(idempotencyKey, userId);
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
    const transaction = transferTxn({
      id: randomUUID(),
      userId,
      idempotencyKey,
      fromAccountId,
      toUsername: normalizedToUsername,
      category: normalizedCategory,
      amount,
      note: normalizedNote,
      isAutoMandate: Boolean(isAutoMandate),
    });
    if (transaction.status === "failed") {
      throw insufficientFundsError(transaction);
    }
    return { transaction: toTransactionJSON(transaction), replayed: false };
  } catch (err) {
    if (err instanceof TransferError) throw err;
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const existing = getTransactionByIdempotencyKeyStmt.get(idempotencyKey, userId);
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

const ownAccountTransferTxn = db.transaction(({ id, userId, idempotencyKey, fromAccountId, toAccountId, amount, note }) => {
  const referenceNumber = generateReferenceNumber();
  const from = getAccountRawStmt.get(fromAccountId);
  if (!from || from.user_id !== userId) {
    throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
  }
  const to = getAccountRawStmt.get(toAccountId);
  if (!to || to.user_id !== userId) {
    throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${toAccountId} not found`);
  }

  if (from.balance < amount) {
    insertTransactionStmt.run({
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
    });
    return getTransactionRawStmt.get(id);
  }

  const debit = debitAccountStmt.run({ amount, accountId: fromAccountId });
  if (debit.changes !== 1) {
    insertTransactionStmt.run({
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
    });
    return getTransactionRawStmt.get(id);
  }

  creditAccountStmt.run({ amount, accountId: toAccountId });

  insertTransactionStmt.run({
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
  });

  return getTransactionRawStmt.get(id);
});

export function transferToOwnAccount({ userId, fromAccountId, toAccountId, amount, idempotencyKey, note }) {
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
    const existing = getTransactionByIdempotencyKeyStmt.get(idempotencyKey, userId);
    if (existing) {
      if (
        existing.from_account_id !== fromAccountId ||
        existing.to_account_id !== toAccountId ||
        existing.amount !== amount
      ) {
        throw new TransferError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key has already been used for a different transfer"
        );
      }
      if (existing.status === "failed") throw insufficientFundsError(existing);
      return { transaction: toTransactionJSON(existing), replayed: true };
    }
  }

  const normalizedNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null;

  try {
    const transaction = ownAccountTransferTxn({
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
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const existing = getTransactionByIdempotencyKeyStmt.get(idempotencyKey, userId);
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

  return { sql: `${TRANSACTION_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at DESC`, params };
}

// Filters are all optional and applied server-side so a large history never
// has to be shipped to the client just to narrow it down: `search` matches
// the note, category, counterparty username/name, or account name (acting as
// the closest thing this app has to a "merchant" match); the rest are plain
// range/equality filters over date, category, and amount.
export function listTransactions(filters = {}) {
  const { sql, params } = buildTransactionFilterQuery(filters);
  return db.prepare(sql).all(params).map(toTransactionJSON);
}

export function iterateTransactions(filters = {}) {
  const { sql, params } = buildTransactionFilterQuery(filters);
  return db.prepare(sql).iterate(params);
}

export function getTransaction(id, userId) {
  const row = getTransactionRawStmt.get(id);
  if (!row) return null;
  const owns = [row.from_account_id, row.to_account_id].some((accId) => {
    const acc = getAccountRawStmt.get(accId);
    return acc?.user_id === userId;
  });
  if (!owns) return null;
  return toTransactionJSON(row);
}

export { TransferError };
export default db;
