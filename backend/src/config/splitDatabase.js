import { randomUUID } from "crypto";
import db, { findUserByUsername } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS expense_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS expense_group_members (
    group_id TEXT NOT NULL REFERENCES expense_groups(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES expense_groups(id),
    description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    paid_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS expense_splits (
    expense_id TEXT NOT NULL REFERENCES expenses(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    share_amount INTEGER NOT NULL CHECK (share_amount >= 0),
    PRIMARY KEY (expense_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES expense_groups(id),
    from_user_id TEXT NOT NULL REFERENCES users(id),
    to_user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid')) DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settlement_payments (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL REFERENCES settlements(id),
    transaction_id TEXT REFERENCES transactions(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_group ON expense_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_group_members_user ON expense_group_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
  CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
  CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(group_id);
  CREATE INDEX IF NOT EXISTS idx_settlement_payments_settlement ON settlement_payments(settlement_id);
`);

class SplitError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---- helpers ----

function toUserSummary(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, name: row.name };
}

function requireMembership(groupId, userId) {
  const row = db.prepare("SELECT 1 FROM expense_group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId);
  if (!row) throw new SplitError(404, "GROUP_NOT_FOUND", "Group not found");
}

function getGroupRaw(groupId) {
  return db.prepare("SELECT * FROM expense_groups WHERE id = ?").get(groupId);
}

// Splits `amount` (integer paise) evenly across `count` participants so the
// shares sum back to exactly `amount` — the leftover paise (amount % count)
// go one-each to the first `count` participants in the given order.
function splitEqual(amount, count) {
  const base = Math.floor(amount / count);
  const remainder = amount - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// ---- groups ----

const insertGroupStmt = db.prepare(
  "INSERT INTO expense_groups (id, name, created_by_user_id) VALUES (@id, @name, @createdByUserId)"
);
const insertGroupMemberStmt = db.prepare(
  "INSERT OR IGNORE INTO expense_group_members (group_id, user_id) VALUES (@groupId, @userId)"
);

const createGroupTxn = db.transaction(({ name, createdByUserId, memberUserIds }) => {
  const id = randomUUID();
  insertGroupStmt.run({ id, name, createdByUserId });
  insertGroupMemberStmt.run({ groupId: id, userId: createdByUserId });
  for (const userId of memberUserIds) {
    insertGroupMemberStmt.run({ groupId: id, userId });
  }
  return id;
});

export function createExpenseGroup(userId, { name, memberUsernames }) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) throw new SplitError(400, "INVALID_GROUP_NAME", "Group name is required");

  const memberUserIds = [];
  for (const username of memberUsernames ?? []) {
    const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
    const user = normalized ? findUserByUsername(normalized) : null;
    if (!user) throw new SplitError(404, "MEMBER_NOT_FOUND", `No user found with username "${username}"`);
    if (user.id !== userId) memberUserIds.push(user.id);
  }

  const groupId = createGroupTxn({ name: trimmedName, createdByUserId: userId, memberUserIds });
  return getExpenseGroupDetail(groupId, userId);
}

export function listExpenseGroups(userId) {
  const groupRows = db
    .prepare(
      `SELECT g.* FROM expense_groups g
       JOIN expense_group_members m ON m.group_id = g.id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(userId);

  return groupRows.map((row) => {
    const balances = computeGroupBalances(row.id);
    const memberCount = db.prepare("SELECT COUNT(*) AS c FROM expense_group_members WHERE group_id = ?").get(row.id).c;
    const yours = balances.find((b) => b.userId === userId);
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      memberCount,
      yourNetBalance: yours ? yours.netBalance : 0,
    };
  });
}

function listGroupMembers(groupId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.name FROM expense_group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY m.joined_at ASC`
    )
    .all(groupId)
    .map(toUserSummary);
}

function listGroupExpenses(groupId) {
  const expenseRows = db
    .prepare(
      `SELECT e.*, u.username AS paid_by_username, u.name AS paid_by_name
       FROM expenses e JOIN users u ON u.id = e.paid_by_user_id
       WHERE e.group_id = ? ORDER BY e.created_at DESC`
    )
    .all(groupId);

  const splitStmt = db.prepare(
    `SELECT s.user_id, s.share_amount, u.username, u.name FROM expense_splits s
     JOIN users u ON u.id = s.user_id WHERE s.expense_id = ?`
  );

  return expenseRows.map((row) => ({
    id: row.id,
    description: row.description,
    amount: row.amount,
    paidByUserId: row.paid_by_user_id,
    paidByUsername: row.paid_by_username,
    paidByName: row.paid_by_name,
    createdAt: row.created_at,
    splits: splitStmt.all(row.id).map((s) => ({
      userId: s.user_id,
      username: s.username,
      name: s.name,
      shareAmount: s.share_amount,
    })),
  }));
}

// Net balance per member = what they've paid across all group expenses minus
// what they owe (their split shares), then adjusted for settlements — a fully
// "paid" settlement counts its whole amount as settled (covers both a real
// full payment and a manual "mark as paid"); a still-"pending" settlement
// counts only whatever's actually been paid toward it so far, so a partial
// payment is reflected immediately without waiting for the rest.
const SETTLED_AMOUNT_EXPR = `CASE WHEN s.status = 'paid' THEN s.amount ELSE COALESCE(sp.paid, 0) END`;
const SETTLEMENT_PAYMENTS_JOIN = `
  LEFT JOIN (
    SELECT settlement_id, SUM(amount) AS paid FROM settlement_payments GROUP BY settlement_id
  ) sp ON sp.settlement_id = s.id
`;

export function computeGroupBalances(groupId) {
  const members = listGroupMembers(groupId);

  const paidRows = db
    .prepare(
      "SELECT paid_by_user_id AS user_id, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE group_id = ? GROUP BY paid_by_user_id"
    )
    .all(groupId);
  const owedRows = db
    .prepare(
      `SELECT s.user_id AS user_id, COALESCE(SUM(s.share_amount), 0) AS total
       FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
       WHERE e.group_id = ? GROUP BY s.user_id`
    )
    .all(groupId);
  const settledFromRows = db
    .prepare(
      `SELECT s.from_user_id AS user_id, COALESCE(SUM(${SETTLED_AMOUNT_EXPR}), 0) AS total
       FROM settlements s ${SETTLEMENT_PAYMENTS_JOIN}
       WHERE s.group_id = ? GROUP BY s.from_user_id`
    )
    .all(groupId);
  const settledToRows = db
    .prepare(
      `SELECT s.to_user_id AS user_id, COALESCE(SUM(${SETTLED_AMOUNT_EXPR}), 0) AS total
       FROM settlements s ${SETTLEMENT_PAYMENTS_JOIN}
       WHERE s.group_id = ? GROUP BY s.to_user_id`
    )
    .all(groupId);

  const paidMap = new Map(paidRows.map((r) => [r.user_id, r.total]));
  const owedMap = new Map(owedRows.map((r) => [r.user_id, r.total]));
  const settledFromMap = new Map(settledFromRows.map((r) => [r.user_id, r.total]));
  const settledToMap = new Map(settledToRows.map((r) => [r.user_id, r.total]));

  return members.map((member) => {
    const paid = paidMap.get(member.id) ?? 0;
    const owed = owedMap.get(member.id) ?? 0;
    const settledFrom = settledFromMap.get(member.id) ?? 0;
    const settledTo = settledToMap.get(member.id) ?? 0;
    return {
      userId: member.id,
      username: member.username,
      name: member.name,
      totalPaid: paid,
      totalOwed: owed,
      netBalance: paid - owed + settledFrom - settledTo,
    };
  });
}

function listGroupSettlements(groupId) {
  return db
    .prepare(
      `SELECT s.*, fu.username AS from_username, fu.name AS from_name, tu.username AS to_username, tu.name AS to_name,
         (SELECT COALESCE(SUM(amount), 0) FROM settlement_payments WHERE settlement_id = s.id) AS amount_paid
       FROM settlements s
       JOIN users fu ON fu.id = s.from_user_id
       JOIN users tu ON tu.id = s.to_user_id
       WHERE s.group_id = ? ORDER BY s.status ASC, s.created_at DESC`
    )
    .all(groupId)
    .map((row) => {
      const amountPaid = row.status === "paid" ? row.amount : row.amount_paid;
      return {
        id: row.id,
        fromUserId: row.from_user_id,
        fromUsername: row.from_username,
        fromName: row.from_name,
        toUserId: row.to_user_id,
        toUsername: row.to_username,
        toName: row.to_name,
        amount: row.amount,
        amountPaid,
        remainingAmount: Math.max(row.amount - amountPaid, 0),
        status: row.status,
        createdAt: row.created_at,
        paidAt: row.paid_at,
      };
    });
}

export function getExpenseGroupDetail(groupId, userId) {
  requireMembership(groupId, userId);
  const group = getGroupRaw(groupId);
  return {
    id: group.id,
    name: group.name,
    createdAt: group.created_at,
    members: listGroupMembers(groupId),
    expenses: listGroupExpenses(groupId),
    balances: computeGroupBalances(groupId),
    settlements: listGroupSettlements(groupId),
  };
}

// ---- members ----

export function addGroupMember(groupId, requestingUserId, username) {
  requireMembership(groupId, requestingUserId);
  const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
  const user = normalized ? findUserByUsername(normalized) : null;
  if (!user) throw new SplitError(404, "MEMBER_NOT_FOUND", `No user found with username "${username}"`);
  insertGroupMemberStmt.run({ groupId, userId: user.id });
  return getExpenseGroupDetail(groupId, requestingUserId);
}

// ---- expenses ----

const insertExpenseStmt = db.prepare(
  `INSERT INTO expenses (id, group_id, description, amount, paid_by_user_id, created_by_user_id)
   VALUES (@id, @groupId, @description, @amount, @paidByUserId, @createdByUserId)`
);
const insertExpenseSplitStmt = db.prepare(
  "INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (@expenseId, @userId, @shareAmount)"
);

const addExpenseTxn = db.transaction(({ groupId, createdByUserId, description, amount, paidByUserId, splits }) => {
  const id = randomUUID();
  insertExpenseStmt.run({ id, groupId, description, amount, paidByUserId, createdByUserId });
  for (const split of splits) {
    insertExpenseSplitStmt.run({ expenseId: id, userId: split.userId, shareAmount: split.shareAmount });
  }
  return id;
});

export function addExpense(
  groupId,
  userId,
  { description, amount, paidByUsername, splitType, participantUsernames, customSplits }
) {
  requireMembership(groupId, userId);

  const trimmedDescription = typeof description === "string" ? description.trim() : "";
  if (!trimmedDescription) throw new SplitError(400, "INVALID_DESCRIPTION", "Description is required");
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new SplitError(400, "INVALID_AMOUNT", "amount must be a positive integer (paise)");
  }

  const members = listGroupMembers(groupId);
  const memberByUsername = new Map(members.map((m) => [m.username, m]));

  const payerUsername =
    typeof paidByUsername === "string" && paidByUsername.trim() ? paidByUsername.trim().toLowerCase() : null;
  const payer = payerUsername ? memberByUsername.get(payerUsername) : members.find((m) => m.id === userId);
  if (!payer) throw new SplitError(400, "INVALID_PAYER", "paidByUsername must be a member of this group");

  let splits;
  if (splitType === "custom") {
    if (!Array.isArray(customSplits) || customSplits.length === 0) {
      throw new SplitError(400, "INVALID_SPLITS", "customSplits must be a non-empty array for a custom split");
    }
    splits = customSplits.map((s) => {
      const member = memberByUsername.get(typeof s.username === "string" ? s.username.trim().toLowerCase() : "");
      if (!member) throw new SplitError(400, "INVALID_SPLITS", `"${s.username}" is not a member of this group`);
      if (!Number.isSafeInteger(s.shareAmount) || s.shareAmount < 0) {
        throw new SplitError(400, "INVALID_SPLITS", "Each share amount must be a non-negative integer (paise)");
      }
      return { userId: member.id, shareAmount: s.shareAmount };
    });
    const total = splits.reduce((sum, s) => sum + s.shareAmount, 0);
    if (total !== amount) {
      throw new SplitError(400, "SPLIT_MISMATCH", "Custom split amounts must add up to the total expense amount");
    }
  } else {
    const usernames =
      Array.isArray(participantUsernames) && participantUsernames.length > 0
        ? participantUsernames
        : members.map((m) => m.username);
    const participants = usernames.map((u) => {
      const member = memberByUsername.get(typeof u === "string" ? u.trim().toLowerCase() : "");
      if (!member) throw new SplitError(400, "INVALID_SPLITS", `"${u}" is not a member of this group`);
      return member;
    });
    if (participants.length === 0) throw new SplitError(400, "INVALID_SPLITS", "At least one participant is required");
    const shares = splitEqual(amount, participants.length);
    splits = participants.map((member, i) => ({ userId: member.id, shareAmount: shares[i] }));
  }

  addExpenseTxn({ groupId, createdByUserId: userId, description: trimmedDescription, amount, paidByUserId: payer.id, splits });
  return getExpenseGroupDetail(groupId, userId);
}

// ---- settlements ----

const insertSettlementStmt = db.prepare(
  `INSERT INTO settlements (id, group_id, from_user_id, to_user_id, amount)
   VALUES (@id, @groupId, @fromUserId, @toUserId, @amount)`
);

// Classic minimum-cash-flow debt simplification: repeatedly match the
// largest creditor with the largest debtor so every match fully clears at
// least one side, producing the fewest possible settlement transactions.
function computeMinimalSettlements(balances) {
  const creditors = balances.filter((b) => b.netBalance > 0).map((b) => ({ userId: b.userId, amount: b.netBalance }));
  const debtors = balances.filter((b) => b.netBalance < 0).map((b) => ({ userId: b.userId, amount: -b.netBalance }));
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);
    if (amount > 0) {
      settlements.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) ci += 1;
    if (debtor.amount === 0) di += 1;
  }

  return settlements;
}

// Only pending settlements with no real payment history are safe to replace
// wholesale — one that's been partially paid carries payment records tied to
// it (and a real transaction behind them), so it's never deleted. Its
// still-outstanding amount is instead subtracted from the freshly computed
// minimal settlement for that same from/to pair, and only the remainder (if
// any — e.g. a new expense added more debt since the partial payment) gets
// inserted as an additional settlement row for that pair.
const preservedPendingWithPaymentsStmt = db.prepare(`
  SELECT s.id, s.from_user_id, s.to_user_id, s.amount,
    (SELECT COALESCE(SUM(amount), 0) FROM settlement_payments WHERE settlement_id = s.id) AS paid
  FROM settlements s
  JOIN settlement_payments p ON p.settlement_id = s.id
  WHERE s.group_id = ? AND s.status = 'pending'
  GROUP BY s.id
`);
const clearUntouchedPendingSettlementsStmt = db.prepare(`
  DELETE FROM settlements WHERE group_id = ? AND status = 'pending'
  AND id NOT IN (SELECT DISTINCT settlement_id FROM settlement_payments)
`);

const generateSettlementsTxn = db.transaction((groupId) => {
  const preservedRemainingByPair = new Map();
  for (const row of preservedPendingWithPaymentsStmt.all(groupId)) {
    const key = `${row.from_user_id}:${row.to_user_id}`;
    const remaining = row.amount - row.paid;
    preservedRemainingByPair.set(key, (preservedRemainingByPair.get(key) ?? 0) + remaining);
  }

  clearUntouchedPendingSettlementsStmt.run(groupId);

  const balances = computeGroupBalances(groupId);
  const minimal = computeMinimalSettlements(balances);
  for (const s of minimal) {
    const key = `${s.fromUserId}:${s.toUserId}`;
    const alreadyCovered = preservedRemainingByPair.get(key) ?? 0;
    const remainder = s.amount - alreadyCovered;
    if (remainder > 0) {
      insertSettlementStmt.run({ id: randomUUID(), groupId, fromUserId: s.fromUserId, toUserId: s.toUserId, amount: remainder });
    }
  }
});

export function generateSettlements(groupId, userId) {
  requireMembership(groupId, userId);
  generateSettlementsTxn(groupId);
  return getExpenseGroupDetail(groupId, userId);
}

const markSettlementPaidStmt = db.prepare(
  "UPDATE settlements SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND group_id = ? AND status = 'pending'"
);

export function markSettlementPaid(groupId, settlementId, userId) {
  requireMembership(groupId, userId);
  const settlement = db.prepare("SELECT * FROM settlements WHERE id = ? AND group_id = ?").get(settlementId, groupId);
  if (!settlement) throw new SplitError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found");
  if (settlement.from_user_id !== userId && settlement.to_user_id !== userId) {
    throw new SplitError(403, "NOT_A_PARTY", "Only the payer or payee can update this settlement");
  }
  if (settlement.status !== "pending") {
    throw new SplitError(400, "ALREADY_PAID", "This settlement is already marked paid");
  }
  const result = markSettlementPaidStmt.run(settlementId, groupId);
  if (result.changes === 0) throw new SplitError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found");
  return getExpenseGroupDetail(groupId, userId);
}

// ---- real (possibly partial) settlement payments ----
// Called after an actual FinFlow transfer has already moved the money —
// this just records that payment against the settlement so the group's
// balances and status reflect it, supporting paying a settlement down in
// more than one go.

const insertSettlementPaymentStmt = db.prepare(
  "INSERT INTO settlement_payments (id, settlement_id, transaction_id, amount) VALUES (@id, @settlementId, @transactionId, @amount)"
);
const settlementPaidSoFarStmt = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total FROM settlement_payments WHERE settlement_id = ?"
);
const markSettlementPaidByIdStmt = db.prepare(
  "UPDATE settlements SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
);

const recordSettlementPaymentTxn = db.transaction(({ settlementId, transactionId, amount, totalAmount }) => {
  insertSettlementPaymentStmt.run({ id: randomUUID(), settlementId, transactionId, amount });
  const paidSoFar = settlementPaidSoFarStmt.get(settlementId).total;
  if (paidSoFar >= totalAmount) {
    markSettlementPaidByIdStmt.run(settlementId);
  }
});

export function recordSettlementPayment(groupId, settlementId, userId, { amount, transactionId }) {
  requireMembership(groupId, userId);
  const settlement = db.prepare("SELECT * FROM settlements WHERE id = ? AND group_id = ?").get(settlementId, groupId);
  if (!settlement) throw new SplitError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found");
  if (settlement.from_user_id !== userId) {
    throw new SplitError(403, "NOT_THE_PAYER", "Only the person who owes this settlement can record a payment toward it");
  }
  if (settlement.status !== "pending") {
    throw new SplitError(400, "ALREADY_PAID", "This settlement is already fully paid");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new SplitError(400, "INVALID_AMOUNT", "amount must be a positive integer (paise)");
  }

  const paidSoFar = settlementPaidSoFarStmt.get(settlementId).total;
  const remaining = settlement.amount - paidSoFar;
  if (amount > remaining) {
    throw new SplitError(400, "OVERPAYMENT", "That amount is more than what's still owed on this settlement");
  }

  recordSettlementPaymentTxn({
    settlementId,
    transactionId: typeof transactionId === "string" && transactionId.trim() ? transactionId.trim() : null,
    amount,
    totalAmount: settlement.amount,
  });
  return getExpenseGroupDetail(groupId, userId);
}

export { SplitError };
