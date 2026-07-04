import { randomUUID } from "crypto";
import db, { normalizeBudgetCategory, listTransactions } from "./database.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS imported_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    source TEXT NOT NULL CHECK (source IN ('csv', 'pdf')),
    merchant TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    entry_type TEXT NOT NULL DEFAULT 'debit' CHECK (entry_type IN ('debit', 'credit')),
    category TEXT NOT NULL DEFAULT 'other',
    occurred_at TEXT NOT NULL,
    raw_text TEXT,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_imported_tx_user ON imported_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_imported_tx_occurred ON imported_transactions(occurred_at);
`);

// Every row inserted by one CSV/PDF upload shares a batch_id, so the whole
// upload can be undone in one shot instead of deleting rows one at a time.
const importedColumns = db.prepare("PRAGMA table_info(imported_transactions)").all().map((c) => c.name);
if (!importedColumns.includes("batch_id")) {
  db.exec("ALTER TABLE imported_transactions ADD COLUMN batch_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_imported_tx_batch ON imported_transactions(batch_id)");
}
if (!importedColumns.includes("entry_type")) {
  db.exec("ALTER TABLE imported_transactions ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'debit'");
}

class ImportError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---- category auto-suggestion ----
// A lightweight keyword match against common merchant names — this is what
// "categorize imported transactions" runs automatically on import; the user
// can still edit any row's category afterward like any other transaction.
const CATEGORY_KEYWORDS = [
  { category: "food", pattern: /swiggy|zomato|restaurant|cafe|food|dominos|pizza|starbucks|dining/i },
  { category: "transport", pattern: /uber|ola|petrol|fuel|metro|irctc|railway|parking|rapido/i },
  { category: "shopping", pattern: /amazon|flipkart|myntra|ajio|mall|store|shop/i },
  { category: "bills", pattern: /electricity|water bill|broadband|wifi|recharge|dth|insurance|rent|emi|loan/i },
  { category: "entertainment", pattern: /netflix|prime video|hotstar|spotify|bookmyshow|movie|cinema/i },
];

function suggestCategory(merchant) {
  const match = CATEGORY_KEYWORDS.find((entry) => entry.pattern.test(merchant));
  return match ? match.category : "other";
}

// ---- CSV parsing ----

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

function parseAmountToPaise(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[₹$€£,\s]/g, "")
    .replace(/^Rs\.?/i, "")
    .replace(/^INR/i, "")
    .replace(/^USD|^EUR|^GBP/i, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

const MONTH_NAMES = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDateToIso(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();

  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  // dd-Mon-yyyy or dd Mon yyyy (e.g. "01-Jul-2026", common in Indian bank statements)
  const dMonY = trimmed.match(/^(\d{1,2})[\/\-.\s]+([A-Za-z]{3,})[\/\-.\s]+(\d{2,4})$/);
  if (dMonY) {
    const [, d, monStr, yRaw] = dMonY;
    const mon = MONTH_NAMES[monStr.slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      const date = new Date(Date.UTC(Number(y), mon, Number(d)));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  // yyyy-mm-dd
  const ymd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  return null;
}

export function parseCsvStatement(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new ImportError(400, "EMPTY_CSV", "The CSV needs a header row and at least one transaction row");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  // FinFlow's own "Export CSV" (on the Transaction History page) uses
  // exactly this column shape — those rows are already tracked as real
  // transactions, so importing that file back in would double-count every
  // payment as external spend too. Catch it before it's parsed as a
  // statement at all, rather than relying on row-level dedup to notice.
  if (header.includes("from") && header.includes("to") && header.some((h) => /status/.test(h))) {
    throw new ImportError(
      400,
      "FINFLOW_EXPORT_DETECTED",
      "This looks like a FinFlow transaction history export, not a bank/card statement — those payments are already tracked automatically, so importing this file would double-count your spending. Import a statement from your bank or card provider instead."
    );
  }

  const dateIdx = header.findIndex((h) => /date/.test(h));
  const merchantIdx = header.findIndex((h) => /merchant|description|payee|narration|details|particulars/.test(h));
  const amountIdx = header.findIndex((h) => /amount|debit|value|withdrawal/.test(h));
  const typeIdx = header.findIndex((h) => /^type$|transaction type|dr\/cr|debit\/credit/.test(h));
  const categoryIdx = header.findIndex((h) => /category/.test(h));

  if (dateIdx === -1 || merchantIdx === -1 || amountIdx === -1) {
    throw new ImportError(
      400,
      "UNRECOGNIZED_COLUMNS",
      'Could not find date, merchant/description, and amount columns. Expected headers like "Date", "Description", "Amount".'
    );
  }

  const rows = [];
  const skipped = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const occurredAt = parseDateToIso(cols[dateIdx]);
    const merchant = (cols[merchantIdx] ?? "").trim();
    const amount = parseAmountToPaise(cols[amountIdx]);
    const rawType = typeIdx >= 0 ? (cols[typeIdx] ?? "").trim().toLowerCase() : "";
    const entryType = /^(credit|cr|deposit)$/.test(rawType) ? "credit" : "debit";
    const category = categoryIdx >= 0 && cols[categoryIdx]?.trim() ? normalizeBudgetCategory(cols[categoryIdx]) : undefined;
    if (!occurredAt || !merchant || !amount) {
      skipped.push(line);
      continue;
    }
    rows.push({ merchant, amount, entryType, category, occurredAt, rawText: line });
  }

  return { rows, skippedCount: skipped.length };
}

// ---- PDF parsing ----
// Bank statement PDF layouts vary wildly. This looks for the common pattern
// of "a date, then a description, then an amount" on one line of extracted
// text. Many statements (e.g. Indian bank passbook exports) additionally
// have an explicit Debit/Credit column *and* a trailing running-balance
// figure after the transaction amount — both need special handling, or the
// parser ends up treating salary credits as spend and grabbing the balance
// instead of the actual amount.
const DATE_TOKEN =
  "\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}[\\/\\-.\\s]+[A-Za-z]{3,}[\\/\\-.\\s]+\\d{2,4}|\\d{4}-\\d{2}-\\d{2}";
// Not anchored to the start of the line — statements that prefix each row
// with a serial number, reference number, or cheque number (common outside
// simple passbook exports) would otherwise never match at all.
const LINE_DATE_RE = new RegExp(`(${DATE_TOKEN})`);
const TYPE_RE = /\b(debit|credit|dr|cr|withdrawal|deposit)\b/i;
const CURRENCY_PREFIX = "(?:₹|\\$|€|£|Rs\\.?|INR|USD|EUR|GBP)";
const AMOUNT_TOKEN_RE = new RegExp(`${CURRENCY_PREFIX}?\\s*([\\d,]+(?:\\.\\d{1,2})?)`);
const AMOUNT_TOKEN_GLOBAL_RE = new RegExp(`${CURRENCY_PREFIX}?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "g");
const TRAILING_AMOUNT_RE = new RegExp(`${CURRENCY_PREFIX}?\\s*([\\d,]+\\.\\d{1,2}|[\\d,]+)\\s*$`);
const TRAILING_AMOUNT_CLUSTER_RE = new RegExp(
  `((?:${CURRENCY_PREFIX}?\\s*[\\d,]+(?:\\.\\d{1,2})?\\s+){0,3}${CURRENCY_PREFIX}?\\s*[\\d,]+(?:\\.\\d{1,2})?)\\s*$`
);
const BALANCE_LINE_RE = /opening balance|closing balance|balance b\/f|balance c\/f/i;

// Many PDF text extractors collapse every row onto one physical line; make
// sure each transaction (which always starts with a date) gets its own line
// before parsing, whether the source text already had line breaks or not.
function splitIntoStatementLines(text) {
  const normalized = text.replace(new RegExp(`(${DATE_TOKEN})(?=\\s)`, "g"), "\n$1");
  return normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function amountMatches(text) {
  return [...String(text ?? "").matchAll(AMOUNT_TOKEN_GLOBAL_RE)].map((match) => ({
    raw: match[1],
    index: match.index ?? 0,
    token: match[0],
  }));
}

export function parsePdfStatementText(text) {
  const lines = splitIntoStatementLines(text);
  const rows = [];
  let skippedCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const dateMatch = trimmedLine.match(LINE_DATE_RE);
    if (!dateMatch) {
      skippedCount++;
      continue;
    }
    const rawDate = dateMatch[1];
    // The date can appear anywhere in the line (e.g. after a serial or
    // cheque number) — treat everything else on the line, with the date
    // token removed, as the description-and-amount text to parse further.
    const rest = (
      trimmedLine.slice(0, dateMatch.index) + " " + trimmedLine.slice(dateMatch.index + dateMatch[0].length)
    ).trim();
    const occurredAt = parseDateToIso(rawDate);
    if (!occurredAt) {
      skippedCount++;
      continue;
    }

    if (BALANCE_LINE_RE.test(rest)) {
      // "Opening Balance" / "Closing Balance" rows aren't transactions.
      skippedCount++;
      continue;
    }

    const typeMatch = rest.match(TYPE_RE);
    let merchant;
    let rawAmount;
    let entryType = "debit";

    if (typeMatch) {
      // Statement has an explicit Debit/Credit column. Credits are imported
      // separately so analytics can show income without counting it as spend.
      entryType = /^(credit|cr|deposit)$/i.test(typeMatch[1]) ? "credit" : "debit";
      merchant = rest.slice(0, typeMatch.index).trim();
      const afterType = rest.slice(typeMatch.index + typeMatch[0].length).trim();
      const amountMatch = afterType.match(AMOUNT_TOKEN_RE);
      // The amount is the FIRST number after the Debit marker — anything
      // after that (a running balance) is deliberately ignored.
      rawAmount = amountMatch ? amountMatch[1] : null;
    } else {
      // No explicit type column — parse the trailing numeric cluster. If a
      // statement has "amount balance" at the end, use the first number in
      // that cluster as the transaction amount and ignore the balance.
      const clusterMatch = rest.match(TRAILING_AMOUNT_CLUSTER_RE) ?? rest.match(TRAILING_AMOUNT_RE);
      if (clusterMatch) {
        const cluster = clusterMatch[1] ?? clusterMatch[0];
        const amounts = amountMatches(cluster);
        const firstLooksLikeReference =
          amounts.length > 1 && !amounts[0].raw.includes(".") && amounts.slice(1).some((amount) => amount.raw.includes("."));
        const chosen = amounts.length > 1 && !firstLooksLikeReference ? amounts[0] : amounts[amounts.length - 1];
        merchant = rest.slice(0, clusterMatch.index).trim();
        rawAmount = chosen?.raw;
      }
    }

    const amount = parseAmountToPaise(rawAmount);
    if (!amount || !merchant) {
      skippedCount++;
      continue;
    }
    rows.push({ merchant, amount, entryType, occurredAt, rawText: trimmedLine });
  }

  if (rows.length === 0) {
    throw new ImportError(
      400,
      "UNPARSEABLE_PDF",
      "Could not find any transaction lines in this PDF. It needs one transaction per line with a date, description, and amount."
    );
  }

  return { rows, skippedCount };
}

// ---- persistence ----

const insertImportedTxStmt = db.prepare(`
  INSERT INTO imported_transactions (id, user_id, source, merchant, amount, entry_type, category, occurred_at, raw_text, batch_id)
  VALUES (@id, @userId, @source, @merchant, @amount, @entryType, @category, @occurredAt, @rawText, @batchId)
`);

const insertManyTxn = db.transaction((userId, source, rows, batchId) => {
  const inserted = [];
  for (const row of rows) {
    const id = randomUUID();
    insertImportedTxStmt.run({
      id,
      userId,
      source,
      merchant: row.merchant,
      amount: row.amount,
      entryType: row.entryType ?? "debit",
      category: row.category ?? suggestCategory(row.merchant),
      occurredAt: row.occurredAt,
      rawText: row.rawText ?? null,
      batchId,
    });
    inserted.push(id);
  }
  return inserted;
});

function toImportedJSON(row) {
  return {
    id: row.id,
    source: row.source,
    merchant: row.merchant,
    amount: row.amount,
    entryType: row.entry_type ?? "debit",
    category: row.category,
    occurredAt: row.occurred_at,
    rawText: row.raw_text,
    importedAt: row.imported_at,
    batchId: row.batch_id,
  };
}

// Same merchant + amount + date + original line of text is treated as the
// same transaction — exact enough to catch re-uploading a statement (or a
// file with repeated lines) without merging two genuinely separate same-day,
// same-amount purchases at the same place, which would have different
// source text (a different reference number, a slightly different line).
function duplicateKey(row) {
  return `${normalizeMerchantKey(row.merchant)}|${row.amount}|${row.entryType ?? "debit"}|${row.occurredAt}|${(row.rawText ?? "").trim()}`;
}

export function importTransactions(userId, source, rows) {
  if (rows.length === 0) {
    throw new ImportError(400, "NO_ROWS", "No valid transaction rows were found to import");
  }

  const existingRows = db.prepare("SELECT merchant, amount, entry_type, occurred_at, raw_text FROM imported_transactions WHERE user_id = ?").all(userId);
  const seenKeys = new Set(
    existingRows.map((r) =>
      duplicateKey({ merchant: r.merchant, amount: r.amount, entryType: r.entry_type, occurredAt: r.occurred_at, rawText: r.raw_text })
    )
  );

  const uniqueRows = [];
  let duplicateCount = 0;
  for (const row of rows) {
    const key = duplicateKey(row);
    if (seenKeys.has(key)) {
      duplicateCount++;
      continue;
    }
    seenKeys.add(key);
    uniqueRows.push(row);
  }

  if (uniqueRows.length === 0) {
    throw new ImportError(
      400,
      "ALL_DUPLICATES",
      "Every row in this file matches a transaction that's already been imported"
    );
  }

  const batchId = randomUUID();
  const ids = insertManyTxn(userId, source, uniqueRows, batchId);
  const placeholders = ids.map(() => "?").join(",");
  const inserted = db
    .prepare(`SELECT * FROM imported_transactions WHERE id IN (${placeholders})`)
    .all(...ids)
    .map(toImportedJSON);
  inserted.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  return { batchId, imported: inserted, duplicateCount };
}

// Undoes one whole upload — every row inserted with the same batch_id.
export function deleteImportBatch(userId, batchId) {
  const result = db.prepare("DELETE FROM imported_transactions WHERE user_id = ? AND batch_id = ?").run(userId, batchId);
  return result.changes;
}

export function listImportedTransactions(userId, { category, dateFrom, dateTo } = {}) {
  const clauses = ["user_id = @userId"];
  const params = { userId };
  if (typeof category === "string" && category.trim()) {
    clauses.push("category = @category");
    params.category = normalizeBudgetCategory(category);
  }
  if (typeof dateFrom === "string" && dateFrom.trim()) {
    clauses.push("occurred_at >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (typeof dateTo === "string" && dateTo.trim()) {
    clauses.push("occurred_at <= @dateTo");
    params.dateTo = dateTo;
  }
  return db
    .prepare(`SELECT * FROM imported_transactions WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC`)
    .all(params)
    .map(toImportedJSON);
}

const updateImportedCategoryStmt = db.prepare(
  "UPDATE imported_transactions SET category = @category WHERE id = @id AND user_id = @userId"
);

export function updateImportedTransactionCategory(userId, id, category) {
  const result = updateImportedCategoryStmt.run({ id, userId, category: normalizeBudgetCategory(category) });
  if (result.changes === 0) return null;
  return toImportedJSON(db.prepare("SELECT * FROM imported_transactions WHERE id = ?").get(id));
}

export function deleteImportedTransaction(userId, id) {
  const result = db.prepare("DELETE FROM imported_transactions WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

// ---- analytics ----
// Combines real FinFlow spending (money sent to someone else — internal
// transfers between your own accounts and settlement/other non-spend
// categories are excluded the same way budgets exclude them) with imported
// statement rows, so the picture covers money spent both on and off FinFlow.

function normalizeMerchantKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeSpendingAnalytics(userId, { dateFrom, dateTo } = {}) {
  const realTransactions = listTransactions({ userId, dateFrom, dateTo, direction: "sent", status: "completed" }).filter(
    (t) => t.category !== "transfer" // exclude money moved between your own accounts
  );
  const imported = listImportedTransactions(userId, { dateFrom, dateTo });
  const importedDebits = imported.filter((t) => (t.entryType ?? "debit") === "debit");
  const importedCredits = imported.filter((t) => t.entryType === "credit");

  const records = [
    ...realTransactions.map((t) => ({
      merchant: t.toUsername === t.fromUsername ? t.toAccountName : t.toName,
      amount: t.amount,
      category: t.category,
      occurredAt: t.createdAt,
      source: "finflow",
    })),
    ...importedDebits.map((t) => ({
      merchant: t.merchant,
      amount: t.amount,
      category: t.category,
      occurredAt: t.occurredAt,
      source: t.source,
    })),
  ];

  const totalSpent = records.reduce((sum, r) => sum + r.amount, 0);
  const totalCredited = importedCredits.reduce((sum, r) => sum + r.amount, 0);

  const byCategoryMap = new Map();
  for (const r of records) {
    byCategoryMap.set(r.category, (byCategoryMap.get(r.category) ?? 0) + r.amount);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, amount]) => ({ category, amount, percent: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const byMonthMap = new Map();
  for (const r of records) {
    const monthKey = r.occurredAt.slice(0, 7); // YYYY-MM
    byMonthMap.set(monthKey, (byMonthMap.get(monthKey) ?? 0) + r.amount);
  }
  const byMonth = [...byMonthMap.entries()]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const byMerchantMap = new Map();
  for (const r of records) {
    const key = normalizeMerchantKey(r.merchant || "Unknown");
    const entry = byMerchantMap.get(key) ?? { merchant: r.merchant, amount: 0, count: 0 };
    entry.amount += r.amount;
    entry.count += 1;
    byMerchantMap.set(key, entry);
  }
  const topMerchants = [...byMerchantMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);

  // Recurring expenses: same merchant appearing 2+ times; classify cadence by
  // the average gap between occurrences.
  const byMerchantOccurrences = new Map();
  for (const r of records) {
    const key = normalizeMerchantKey(r.merchant || "Unknown");
    const list = byMerchantOccurrences.get(key) ?? [];
    list.push(r);
    byMerchantOccurrences.set(key, list);
  }
  const recurring = [];
  for (const [, list] of byMerchantOccurrences) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].occurredAt) - new Date(sorted[i - 1].occurredAt)) / 86400000;
      gaps.push(days);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    let cadence = "Recurring";
    if (avgGap >= 25 && avgGap <= 35) cadence = "Monthly";
    else if (avgGap >= 6 && avgGap <= 8) cadence = "Weekly";
    else if (avgGap >= 12 && avgGap <= 16) cadence = "Biweekly";
    else if (avgGap >= 350 && avgGap <= 380) cadence = "Yearly";

    recurring.push({
      merchant: sorted[0].merchant,
      category: sorted[sorted.length - 1].category,
      occurrences: sorted.length,
      averageAmount: Math.round(sorted.reduce((sum, r) => sum + r.amount, 0) / sorted.length),
      lastAmount: sorted[sorted.length - 1].amount,
      lastOccurredAt: sorted[sorted.length - 1].occurredAt,
      cadence,
    });
  }
  recurring.sort((a, b) => b.occurrences - a.occurrences);

  return {
    totalSpent,
    totalCredited,
    transactionCount: records.length,
    byCategory,
    byMonth,
    topMerchants,
    recurring,
  };
}

export { ImportError, suggestCategory };
