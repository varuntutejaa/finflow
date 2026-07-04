import { randomUUID } from "crypto";
import db, { transfer, getAccount, findUserByUsername, normalizeBudgetCategory, TransferError } from "./database.js";

const RECURRING_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS recurring_payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    from_account_id TEXT NOT NULL REFERENCES accounts(id),
    to_username TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    amount INTEGER NOT NULL CHECK (amount > 0),
    frequency TEXT NOT NULL CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly')),
    next_run_at TEXT NOT NULL,
    last_run_at TEXT,
    last_status TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_payments(user_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_payments(active, next_run_at);
`;

db.exec(RECURRING_TABLE_DDL);

// SQLite can't alter a CHECK constraint in place — databases created before
// "once" (schedule-ahead, single-run) existed still have the old
// frequency CHECK and would reject inserts. Rebuild the table in that case.
const existingRecurringTable = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recurring_payments'")
  .get();
if (existingRecurringTable && !existingRecurringTable.sql.includes("'once'")) {
  db.exec("ALTER TABLE recurring_payments RENAME TO recurring_payments_pre_once");
  db.exec(RECURRING_TABLE_DDL);
  db.exec("INSERT INTO recurring_payments SELECT * FROM recurring_payments_pre_once");
  db.exec("DROP TABLE recurring_payments_pre_once");
}

export class RecurringPaymentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// "once" is a single scheduled transfer for a future date/time (schedule
// ahead, no repeat); the rest repeat on a fixed cadence until cancelled.
const FREQUENCIES = ["once", "daily", "weekly", "monthly"];

function advanceDate(iso, frequency) {
  const date = new Date(iso);
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function toRecurringJSON(row) {
  if (!row) return row;
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    fromAccountName: row.from_account_name,
    toUsername: row.to_username,
    toName: row.to_name,
    category: row.category,
    amount: row.amount,
    frequency: row.frequency,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

const RECURRING_SELECT = `
  SELECT r.*, a.account_name AS from_account_name, u.name AS to_name
  FROM recurring_payments r
  JOIN accounts a ON a.id = r.from_account_id
  LEFT JOIN users u ON u.username = r.to_username
`;

const insertRecurringStmt = db.prepare(`
  INSERT INTO recurring_payments (id, user_id, from_account_id, to_username, category, amount, frequency, next_run_at)
  VALUES (@id, @userId, @fromAccountId, @toUsername, @category, @amount, @frequency, @nextRunAt)
`);
const listRecurringStmt = db.prepare(`${RECURRING_SELECT} WHERE r.user_id = ? ORDER BY r.next_run_at ASC`);
const cancelRecurringStmt = db.prepare("UPDATE recurring_payments SET active = 0 WHERE id = @id AND user_id = @userId");
const listDueStmt = db.prepare("SELECT * FROM recurring_payments WHERE active = 1 AND next_run_at <= ?");
const advanceRecurringStmt = db.prepare(`
  UPDATE recurring_payments
  SET next_run_at = @nextRunAt, last_run_at = @lastRunAt, last_status = @lastStatus, active = @active
  WHERE id = @id
`);

export function createRecurringPayment({ userId, fromAccountId, toUsername, amount, category, frequency, startAt }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RecurringPaymentError(400, "INVALID_AMOUNT", "amount must be a positive integer (cents)");
  }
  if (!FREQUENCIES.includes(frequency)) {
    throw new RecurringPaymentError(400, "INVALID_FREQUENCY", "frequency must be once, daily, weekly, or monthly");
  }
  if (frequency === "once") {
    const parsed = startAt ? new Date(startAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new RecurringPaymentError(400, "INVALID_START_AT", "startAt must be a future date for a one-time schedule");
    }
  }
  if (typeof toUsername !== "string" || toUsername.trim().length === 0) {
    throw new RecurringPaymentError(400, "INVALID_ACCOUNT", "toUsername is required");
  }
  const account = getAccount(fromAccountId, userId);
  if (!account) {
    throw new RecurringPaymentError(404, "ACCOUNT_NOT_FOUND", `Account ${fromAccountId} not found`);
  }
  const normalizedToUsername = toUsername.trim().toLowerCase();
  const recipient = findUserByUsername(normalizedToUsername);
  if (!recipient) {
    throw new RecurringPaymentError(404, "RECIPIENT_NOT_FOUND", `${toUsername} was not found`);
  }
  if (recipient.id === userId) {
    throw new RecurringPaymentError(400, "SELF_TRANSFER_BLOCKED", "Recurring transfers to your own username are not allowed");
  }

  const nextRunAt = startAt ? new Date(startAt).toISOString() : new Date().toISOString();
  const id = randomUUID();
  insertRecurringStmt.run({
    id,
    userId,
    fromAccountId,
    toUsername: normalizedToUsername,
    category: normalizeBudgetCategory(category),
    amount,
    frequency,
    nextRunAt,
  });
  return findOneJSON(id);
}

function findOneJSON(id) {
  const row = db.prepare(`${RECURRING_SELECT} WHERE r.id = ?`).get(id);
  return toRecurringJSON(row);
}

export function listRecurringPayments(userId) {
  return listRecurringStmt.all(userId).map(toRecurringJSON);
}

export function cancelRecurringPayment(userId, id) {
  const result = cancelRecurringStmt.run({ id, userId });
  return result.changes > 0;
}

// Runs every tick of the in-process scheduler (see server.js) — picks up
// every active mandate whose next_run_at has arrived and fires the transfer
// through the same core `transfer()` used by the live "Pay" flow, so
// recurring payments respect the exact same balance/account rules. No PIN
// is re-entered here: the mandate was authorized with the PIN once, at
// creation time, same as a real standing instruction.
export function runDueRecurringPayments(now = new Date().toISOString()) {
  const due = listDueStmt.all(now);
  const results = [];
  for (const row of due) {
    let status = "completed";
    try {
      const { transaction } = transfer({
        userId: row.user_id,
        fromAccountId: row.from_account_id,
        toUsername: row.to_username,
        amount: row.amount,
        category: row.category,
        idempotencyKey: `recurring:${row.id}:${row.next_run_at}`,
        isAutoMandate: true,
        // Lets the frontend's auto-mandate toast tell a one-off scheduled
        // payment apart from a repeating one, without a separate column.
        note: row.frequency === "once" ? "Scheduled payment" : "Recurring payment",
      });
      if (transaction.status === "failed") status = "failed";
    } catch (err) {
      if (!(err instanceof TransferError)) throw err;
      status = "failed";
    }
    // A "once" mandate never repeats — deactivate it right after its single
    // run instead of computing a next occurrence.
    advanceRecurringStmt.run({
      id: row.id,
      nextRunAt: row.frequency === "once" ? row.next_run_at : advanceDate(row.next_run_at, row.frequency),
      lastRunAt: now,
      lastStatus: status,
      active: row.frequency === "once" ? 0 : 1,
    });
    results.push({ id: row.id, status });
  }
  return results;
}
