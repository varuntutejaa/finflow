import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { pool, dbGet, dbAll, dbRun } from "./db.js";
// Side-effect-only import: `investments.user_id` references `users(id)`, so
// database.js's table creation must finish first. ES modules only guarantee
// that ordering when there's an actual import edge — investmentDatabase.js
// doesn't otherwise need anything from database.js, unlike
// recurring/split/importDatabase.js which already import real functions
// from it and get this ordering for free.
import "./database.js";
import { fetchMutualFundNav, resolveStockSymbol, fetchStockPrice } from "./priceFeeds.js";

await pool.query(`
  CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'Manual',
    type TEXT NOT NULL DEFAULT 'stock' CHECK (type IN ('stock', 'mutual_fund', 'etf', 'crypto', 'gold', 'other')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    buy_price INTEGER NOT NULL CHECK (buy_price >= 0),
    current_price INTEGER NOT NULL CHECK (current_price >= 0),
    notes TEXT,
    -- Caches the resolved Yahoo Finance ticker for a holding (e.g.
    -- "ETERNAL.NS") so live price refreshes don't need to re-run the
    -- name -> symbol search every time — only the first refresh pays that cost.
    symbol TEXT,
    created_at TEXT NOT NULL DEFAULT iso_now(),
    updated_at TEXT NOT NULL DEFAULT iso_now()
  );

  CREATE INDEX IF NOT EXISTS idx_investments_user ON investments(user_id);
`);

export class InvestmentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VALID_TYPES = ["stock", "mutual_fund", "etf", "crypto", "gold", "other"];

function toInvestmentJSON(row) {
  if (!row) return row;
  const investedValue = Math.round(row.quantity * row.buy_price);
  const currentValue = Math.round(row.quantity * row.current_price);
  const gainLoss = currentValue - investedValue;
  const gainLossPercent = investedValue > 0 ? Math.round((gainLoss / investedValue) * 10000) / 100 : 0;
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    type: row.type,
    quantity: row.quantity,
    buyPrice: row.buy_price,
    currentPrice: row.current_price,
    symbol: row.symbol ?? null,
    notes: row.notes ?? null,
    investedValue,
    currentValue,
    gainLoss,
    gainLossPercent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INSERT_INVESTMENT_SQL = `
  INSERT INTO investments (id, user_id, name, platform, type, quantity, buy_price, current_price, notes, symbol)
  VALUES (@id, @userId, @name, @platform, @type, @quantity, @buyPrice, @currentPrice, @notes, @symbol)
`;
const GET_INVESTMENT_RAW_SQL = "SELECT * FROM investments WHERE id = ? AND user_id = ?";
const LIST_INVESTMENTS_SQL = "SELECT * FROM investments WHERE user_id = ? ORDER BY created_at DESC";
const FIND_INVESTMENT_BY_SYMBOL_SQL =
  "SELECT * FROM investments WHERE user_id = ? AND type = ? AND symbol IS NOT NULL AND lower(symbol) = lower(?) ORDER BY updated_at DESC LIMIT 1";
const FIND_INVESTMENT_BY_IDENTITY_SQL =
  "SELECT * FROM investments WHERE user_id = ? AND type = ? AND lower(name) = lower(?) AND lower(platform) = lower(?) ORDER BY updated_at DESC LIMIT 1";

function validateInvestmentInput({ name, platform, type, quantity, buyPrice, currentPrice }) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new InvestmentError(400, "INVALID_NAME", "name is required");
  }
  if (type !== undefined && !VALID_TYPES.includes(type)) {
    throw new InvestmentError(400, "INVALID_TYPE", `type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new InvestmentError(400, "INVALID_QUANTITY", "quantity must be a positive number");
  }
  if (!Number.isSafeInteger(buyPrice) || buyPrice < 0) {
    throw new InvestmentError(400, "INVALID_BUY_PRICE", "buyPrice must be a non-negative integer (paise)");
  }
  if (!Number.isSafeInteger(currentPrice) || currentPrice < 0) {
    throw new InvestmentError(400, "INVALID_CURRENT_PRICE", "currentPrice must be a non-negative integer (paise)");
  }
  if (platform !== undefined && typeof platform !== "string") {
    throw new InvestmentError(400, "INVALID_PLATFORM", "platform must be a string");
  }
}

export async function createInvestment(userId, input) {
  validateInvestmentInput(input);
  const type = input.type ?? "stock";
  const name = input.name.trim();
  const platform = (input.platform && input.platform.trim()) || "Manual";
  const symbol = input.symbol?.trim() || null;
  const existing = symbol
    ? await dbGet(FIND_INVESTMENT_BY_SYMBOL_SQL, userId, type, symbol)
    : await dbGet(FIND_INVESTMENT_BY_IDENTITY_SQL, userId, type, name, platform);

  if (existing) {
    const nextQuantity = existing.quantity + input.quantity;
    const nextInvestedValue = Math.round(existing.quantity * existing.buy_price + input.quantity * input.buyPrice);
    const mergedPlatform =
      existing.platform.toLowerCase() === platform.toLowerCase() ? existing.platform : "Multiple";
    return updateInvestment(userId, existing.id, {
      name: existing.name,
      platform: mergedPlatform,
      type,
      quantity: nextQuantity,
      buyPrice: Math.round(nextInvestedValue / nextQuantity),
      currentPrice: input.currentPrice,
      notes: existing.notes ?? input.notes,
      symbol: existing.symbol ?? symbol,
    });
  }

  const id = randomUUID();
  await dbRun(INSERT_INVESTMENT_SQL, {
    id,
    userId,
    name,
    platform,
    type,
    quantity: input.quantity,
    buyPrice: input.buyPrice,
    currentPrice: input.currentPrice,
    notes: input.notes?.trim() || null,
    symbol,
  });
  return toInvestmentJSON(await dbGet(GET_INVESTMENT_RAW_SQL, id, userId));
}

export async function listInvestments(userId) {
  const rows = await dbAll(LIST_INVESTMENTS_SQL, userId);
  return rows.map(toInvestmentJSON);
}

export async function updateInvestment(userId, id, input) {
  const existing = await dbGet(GET_INVESTMENT_RAW_SQL, id, userId);
  if (!existing) return null;

  const merged = {
    name: input.name ?? existing.name,
    platform: input.platform ?? existing.platform,
    type: input.type ?? existing.type,
    quantity: input.quantity ?? existing.quantity,
    buyPrice: input.buyPrice ?? existing.buy_price,
    currentPrice: input.currentPrice ?? existing.current_price,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    symbol: input.symbol !== undefined ? input.symbol : existing.symbol,
  };
  validateInvestmentInput(merged);

  await dbRun(
    `UPDATE investments
     SET name = @name, platform = @platform, type = @type, quantity = @quantity,
         buy_price = @buyPrice, current_price = @currentPrice, notes = @notes, symbol = @symbol,
         updated_at = iso_now()
     WHERE id = @id AND user_id = @userId`,
    {
      id,
      userId,
      name: merged.name.trim(),
      platform: (merged.platform && merged.platform.trim()) || "Manual",
      type: merged.type,
      quantity: merged.quantity,
      buyPrice: merged.buyPrice,
      currentPrice: merged.currentPrice,
      notes: merged.notes?.trim ? merged.notes.trim() || null : merged.notes,
      symbol: merged.symbol?.trim ? merged.symbol.trim() || null : merged.symbol,
    }
  );

  return toInvestmentJSON(await dbGet(GET_INVESTMENT_RAW_SQL, id, userId));
}

export async function deleteInvestment(userId, id) {
  const result = await dbRun("DELETE FROM investments WHERE id = ? AND user_id = ?", id, userId);
  return result.changes > 0;
}

export async function getInvestmentSummary(userId) {
  const investments = await listInvestments(userId);
  const investedValue = investments.reduce((sum, inv) => sum + inv.investedValue, 0);
  const currentValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
  const gainLoss = currentValue - investedValue;
  const gainLossPercent = investedValue > 0 ? Math.round((gainLoss / investedValue) * 10000) / 100 : 0;
  return { investedValue, currentValue, gainLoss, gainLossPercent, holdingCount: investments.length };
}

// ---- Groww mutual fund holdings import (.xlsx) ----
// Groww's "Holdings as on <date>" export isn't a plain table — it leads with
// a Name/Mobile/PAN block and a portfolio summary before the actual holdings
// table appears, and its exact row offset varies. So instead of assuming a
// fixed row/column layout, this scans for the header row by its column
// *names* (same header-driven approach as the CSV bank-statement importer)
// and reads until the first fully blank row after it.
const REQUIRED_HEADERS = ["scheme name", "units", "invested value", "current value"];

function normalizeHeaderCell(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cellNumber(value) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) return Number(value.result);
  if (typeof value === "string") {
    const cleaned = value.replace(/[₹,\s]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
}

async function loadXlsxRows(source) {
  const workbook = new ExcelJS.Workbook();
  if (Buffer.isBuffer(source)) {
    await workbook.xlsx.load(source);
  } else {
    await workbook.xlsx.readFile(source);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new InvestmentError(400, "UNPARSEABLE_XLSX", "This file has no sheets to read.");
  }
  const allRows = [];
  worksheet.eachRow((row) => {
    // row.values is 1-indexed with a leading empty slot — drop it so column
    // indices below line up with a normal 0-indexed array.
    allRows.push(row.values.slice(1));
  });
  return allRows;
}

export async function parseGrowwMutualFundXlsx(buffer) {
  const allRows = await loadXlsxRows(buffer);

  let headerIndex = -1;
  let columns = {};
  for (let i = 0; i < allRows.length; i++) {
    const normalized = allRows[i].map(normalizeHeaderCell);
    if (REQUIRED_HEADERS.every((h) => normalized.includes(h))) {
      headerIndex = i;
      columns = {
        schemeName: normalized.indexOf("scheme name"),
        amc: normalized.indexOf("amc"),
        category: normalized.indexOf("category"),
        subCategory: normalized.indexOf("sub-category"),
        folioNo: normalized.indexOf("folio no."),
        source: normalized.indexOf("source"),
        units: normalized.indexOf("units"),
        investedValue: normalized.indexOf("invested value"),
        currentValue: normalized.indexOf("current value"),
      };
      break;
    }
  }

  if (headerIndex === -1) {
    throw new InvestmentError(
      400,
      "UNRECOGNIZED_COLUMNS",
      "Could not find the holdings table in this file — expected columns like Scheme Name, Units, Invested Value, Current Value."
    );
  }

  const rows = [];
  const skipped = [];
  for (let i = headerIndex + 1; i < allRows.length; i++) {
    const cells = allRows[i];
    const isBlank = !cells || cells.every((c) => cellText(c).length === 0);
    if (isBlank) break;

    const name = cellText(cells[columns.schemeName]);
    const units = cellNumber(cells[columns.units]);
    const investedValueRupees = cellNumber(cells[columns.investedValue]);
    const currentValueRupees = cellNumber(cells[columns.currentValue]);

    if (!name || !units || units <= 0 || investedValueRupees === null || currentValueRupees === null) {
      skipped.push(i);
      continue;
    }

    const investedValuePaise = Math.round(investedValueRupees * 100);
    const currentValuePaise = Math.round(currentValueRupees * 100);
    const amc = columns.amc >= 0 ? cellText(cells[columns.amc]) : "";
    const category = columns.category >= 0 ? cellText(cells[columns.category]) : "";
    const subCategory = columns.subCategory >= 0 ? cellText(cells[columns.subCategory]) : "";
    const folioNo = columns.folioNo >= 0 ? cellText(cells[columns.folioNo]) : "";
    const source = columns.source >= 0 ? cellText(cells[columns.source]) : "";

    rows.push({
      name,
      platform: source || "Groww",
      type: "mutual_fund",
      quantity: units,
      buyPrice: Math.round(investedValuePaise / units),
      currentPrice: Math.round(currentValuePaise / units),
      notes: [amc, [category, subCategory].filter(Boolean).join(" / "), folioNo && `Folio ${folioNo}`]
        .filter(Boolean)
        .join(" · "),
    });
  }

  if (rows.length === 0) {
    throw new InvestmentError(400, "UNPARSEABLE_XLSX", "No holdings rows were found under the header row in this file.");
  }

  return { rows, skippedCount: skipped.length };
}

// ---- Groww stock holdings import (.xlsx) ----
// Same "Name/Client Code" header block + Summary section pattern as the
// mutual fund export, but the holdings table itself already gives per-unit
// average buy price and closing price directly — no need to derive a
// per-unit price from a total, so this one carries over exactly.
const STOCK_REQUIRED_HEADERS = ["stock name", "quantity", "average buy price", "closing price"];

export async function parseGrowwStockHoldingsXlsx(buffer) {
  const allRows = await loadXlsxRows(buffer);

  let headerIndex = -1;
  let columns = {};
  for (let i = 0; i < allRows.length; i++) {
    const normalized = allRows[i].map(normalizeHeaderCell);
    if (STOCK_REQUIRED_HEADERS.every((h) => normalized.includes(h))) {
      headerIndex = i;
      columns = {
        stockName: normalized.indexOf("stock name"),
        isin: normalized.indexOf("isin"),
        quantity: normalized.indexOf("quantity"),
        avgBuyPrice: normalized.indexOf("average buy price"),
        closingPrice: normalized.indexOf("closing price"),
      };
      break;
    }
  }

  if (headerIndex === -1) {
    throw new InvestmentError(
      400,
      "UNRECOGNIZED_COLUMNS",
      "Could not find the holdings table in this file — expected columns like Stock Name, Quantity, Average buy price, Closing price."
    );
  }

  const rows = [];
  const skipped = [];
  for (let i = headerIndex + 1; i < allRows.length; i++) {
    const cells = allRows[i];
    const isBlank = !cells || cells.every((c) => cellText(c).length === 0);
    if (isBlank) break;

    const name = cellText(cells[columns.stockName]);
    const quantity = cellNumber(cells[columns.quantity]);
    const avgBuyPrice = cellNumber(cells[columns.avgBuyPrice]);
    const closingPrice = cellNumber(cells[columns.closingPrice]);

    if (!name || !quantity || quantity <= 0 || avgBuyPrice === null || closingPrice === null) {
      skipped.push(i);
      continue;
    }

    const isin = columns.isin >= 0 ? cellText(cells[columns.isin]) : "";

    rows.push({
      name,
      platform: "Groww",
      type: "stock",
      quantity,
      buyPrice: Math.round(avgBuyPrice * 100),
      currentPrice: Math.round(closingPrice * 100),
      notes: isin ? `ISIN ${isin}` : "",
    });
  }

  if (rows.length === 0) {
    throw new InvestmentError(400, "UNPARSEABLE_XLSX", "No holdings rows were found under the header row in this file.");
  }

  return { rows, skippedCount: skipped.length };
}

const FIND_INVESTMENT_BY_NAME_PLATFORM_SQL =
  "SELECT id FROM investments WHERE user_id = ? AND lower(name) = lower(?) AND lower(platform) = lower(?)";

// Re-importing the same statement should refresh existing holdings' numbers
// rather than pile up duplicates, so this upserts by (name, platform).
export async function importInvestments(userId, rows) {
  let importedCount = 0;
  let updatedCount = 0;
  for (const row of rows) {
    const existing = await dbGet(FIND_INVESTMENT_BY_NAME_PLATFORM_SQL, userId, row.name, row.platform);
    if (existing) {
      await updateInvestment(userId, existing.id, row);
      updatedCount++;
    } else {
      await createInvestment(userId, row);
      importedCount++;
    }
  }
  return { importedCount, updatedCount };
}

// ---- live price refresh ----
// Walks every holding and tries to fetch its latest price — mutual funds
// against AMFI, everything else against Yahoo Finance. Each holding is
// independent: one failing (unmatched fund, delisted ticker, a flaky
// network call) never blocks the rest from updating.
export async function refreshInvestmentPrices(userId) {
  const investments = await listInvestments(userId);
  let updatedCount = 0;
  const unmatched = [];
  const startedAt = Date.now();

  for (const inv of investments) {
    try {
      if (inv.type === "mutual_fund") {
        const nav = await fetchMutualFundNav(inv.name);
        if (nav === null) {
          unmatched.push({ id: inv.id, name: inv.name, reason: "No matching AMFI scheme found" });
          console.warn(`[priceRefresh] user=${userId} mutual_fund "${inv.name}" (${inv.id}): no matching AMFI scheme`);
          continue;
        }
        await updateInvestment(userId, inv.id, { currentPrice: Math.round(nav * 100) });
        updatedCount++;
        continue;
      }

      let symbol = inv.symbol;
      if (!symbol) {
        symbol = await resolveStockSymbol(inv.name);
        if (!symbol) {
          unmatched.push({ id: inv.id, name: inv.name, reason: "Could not find a matching ticker symbol" });
          console.warn(`[priceRefresh] user=${userId} ${inv.type} "${inv.name}" (${inv.id}): no matching ticker symbol`);
          continue;
        }
      }
      const price = await fetchStockPrice(symbol);
      if (price === null) {
        unmatched.push({ id: inv.id, name: inv.name, reason: `No live price available for ${symbol}` });
        console.warn(`[priceRefresh] user=${userId} ${inv.type} "${inv.name}" (${inv.id}): no live price for symbol ${symbol}`);
        continue;
      }
      await updateInvestment(userId, inv.id, { currentPrice: Math.round(price * 100), symbol });
      updatedCount++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Price lookup failed";
      unmatched.push({ id: inv.id, name: inv.name, reason });
      console.error(`[priceRefresh] user=${userId} ${inv.type} "${inv.name}" (${inv.id}) failed: ${reason}`);
    }
  }

  console.log(
    `[priceRefresh] user=${userId} done in ${Date.now() - startedAt}ms: ${updatedCount}/${investments.length} updated, ${unmatched.length} unmatched`
  );

  return {
    investments: await listInvestments(userId),
    summary: await getInvestmentSummary(userId),
    updatedCount,
    unmatchedCount: unmatched.length,
    unmatched,
  };
}
