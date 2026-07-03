import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "finflow.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_initiator ON transactions(initiated_by_user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_account_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_account_id);

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
    idempotencyKey: row.idempotency_key,
    fromAccountId: row.from_account_id,
    fromAccountName: row.from_account_name,
    fromUsername: row.from_username,
    toAccountId: row.to_account_id,
    toAccountName: row.to_account_name,
    toUsername: row.to_username,
    amount: row.amount,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

const TRANSACTION_SELECT = `
  SELECT
    t.*,
    fa.account_name AS from_account_name, fu.username AS from_username,
    ta.account_name AS to_account_name, tu.username AS to_username
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

// ---- transactions / transfers ----

const debitAccountStmt = db.prepare(
  "UPDATE accounts SET balance = balance - @amount WHERE id = @accountId AND balance >= @amount"
);
const creditAccountStmt = db.prepare(
  "UPDATE accounts SET balance = balance + @amount WHERE id = @accountId"
);
const insertTransactionStmt = db.prepare(`
  INSERT INTO transactions (id, initiated_by_user_id, idempotency_key, from_account_id, to_account_id, amount, status, failure_reason)
  VALUES (@id, @userId, @idempotencyKey, @fromAccountId, @toAccountId, @amount, @status, @failureReason)
`);
const getTransactionRawStmt = db.prepare(`${TRANSACTION_SELECT} WHERE t.id = ?`);
const getTransactionByIdempotencyKeyStmt = db.prepare(
  `${TRANSACTION_SELECT} WHERE t.idempotency_key = ? AND t.initiated_by_user_id = ?`
);

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

function assertSameIdempotentTransfer(existing, { fromAccountId, toUsername, amount }) {
  if (existing.from_account_id !== fromAccountId || existing.to_username !== toUsername || existing.amount !== amount) {
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
  ({ id, userId, idempotencyKey, fromAccountId, toUsername, amount }) => {
    const from = getAccountRawStmt.get(fromAccountId);
    if (!from || from.user_id !== userId) {
      throw new TransferError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
    }

    const toAccountId = resolveDestinationAccountId(userId, fromAccountId, toUsername);

    if (from.balance < amount) {
      insertTransactionStmt.run({
        id,
        userId,
        idempotencyKey: idempotencyKey ?? null,
        fromAccountId,
        toAccountId,
        amount,
        status: "failed",
        failureReason: "insufficient_funds",
      });
      return getTransactionRawStmt.get(id);
    }

    const debit = debitAccountStmt.run({ amount, accountId: fromAccountId });
    if (debit.changes !== 1) {
      insertTransactionStmt.run({
        id,
        userId,
        idempotencyKey: idempotencyKey ?? null,
        fromAccountId,
        toAccountId,
        amount,
        status: "failed",
        failureReason: "insufficient_funds",
      });
      return getTransactionRawStmt.get(id);
    }

    const credit = creditAccountStmt.run({ amount, accountId: toAccountId });
    if (credit.changes !== 1) {
      throw new TransferError(404, "RECIPIENT_NOT_FOUND", "Recipient account is no longer available");
    }

    insertTransactionStmt.run({
      id,
      userId,
      idempotencyKey: idempotencyKey ?? null,
      fromAccountId,
      toAccountId,
      amount,
      status: "completed",
      failureReason: null,
    });

    return getTransactionRawStmt.get(id);
  }
);

export function transfer({ userId, fromAccountId, toUsername, amount, idempotencyKey }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TransferError(400, "INVALID_AMOUNT", "amount must be a positive integer (cents)");
  }
  if (typeof fromAccountId !== "string" || typeof toUsername !== "string" || toUsername.trim().length === 0) {
    throw new TransferError(400, "INVALID_ACCOUNT", "fromAccountId and toUsername are required");
  }

  const normalizedToUsername = toUsername.trim().toLowerCase();

  if (idempotencyKey) {
    const existing = getTransactionByIdempotencyKeyStmt.get(idempotencyKey, userId);
    if (existing) {
      assertSameIdempotentTransfer(existing, { fromAccountId, toUsername: normalizedToUsername, amount });
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
      amount,
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
        assertSameIdempotentTransfer(existing, { fromAccountId, toUsername: normalizedToUsername, amount });
        if (existing.status === "failed") throw insufficientFundsError(existing);
        return { transaction: toTransactionJSON(existing), replayed: true };
      }
    }
    throw err;
  }
}

export function listTransactions({ userId, accountId }) {
  const owned = "(SELECT id FROM accounts WHERE user_id = @userId)";
  const clauses = [`(t.from_account_id IN ${owned} OR t.to_account_id IN ${owned})`];
  if (accountId) clauses.push("(t.from_account_id = @accountId OR t.to_account_id = @accountId)");

  return db
    .prepare(`${TRANSACTION_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t.created_at DESC`)
    .all({ userId, accountId: accountId ?? null })
    .map(toTransactionJSON);
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
