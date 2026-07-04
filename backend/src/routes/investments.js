import { Router } from "express";
import multer from "multer";
import {
  createInvestment,
  listInvestments,
  updateInvestment,
  deleteInvestment,
  getInvestmentSummary,
  parseGrowwMutualFundXlsx,
  parseGrowwStockHoldingsXlsx,
  importInvestments,
  refreshInvestmentPrices,
  InvestmentError,
} from "../config/investmentDatabase.js";
import {
  searchStockSuggestions,
  searchMutualFundSuggestions,
  fetchStockPrice,
  fetchMutualFundNavByCode,
} from "../config/priceFeeds.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

// Streamed as multipart/form-data rather than base64-in-JSON (see
// routes/imports.js for why that pattern is avoided elsewhere in this app).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function handleInvestmentError(err, res) {
  if (err instanceof InvestmentError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

function uploadSingleFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10MB)" : "Could not read the uploaded file";
      return res.status(400).json({ error: { code: "INVALID_FILE", message } });
    }
    next();
  });
}

router.get("/", (req, res) => {
  res.json({
    investments: listInvestments(req.userId),
    summary: getInvestmentSummary(req.userId),
  });
});

router.get("/search/stocks", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    res.json(await searchStockSuggestions(q));
  } catch {
    res.status(502).json({ error: { code: "SEARCH_FAILED", message: "Could not reach the price service. Try again in a moment." } });
  }
});

router.get("/search/mutual-funds", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    res.json(await searchMutualFundSuggestions(q));
  } catch {
    res.status(502).json({ error: { code: "SEARCH_FAILED", message: "Could not reach the price service. Try again in a moment." } });
  }
});

// Used right after picking a suggestion in the "Add a holding" form, so the
// Current price field can be pre-filled instead of typed in by hand.
router.get("/quote/stock", async (req, res) => {
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : "";
  if (!symbol) {
    return res.status(400).json({ error: { code: "INVALID_SYMBOL", message: "symbol is required" } });
  }
  try {
    const price = await fetchStockPrice(symbol);
    if (price === null) {
      return res.status(404).json({ error: { code: "PRICE_NOT_FOUND", message: `No live price available for ${symbol}` } });
    }
    res.json({ price });
  } catch {
    res.status(502).json({ error: { code: "QUOTE_FAILED", message: "Could not reach the price service. Try again in a moment." } });
  }
});

router.get("/quote/mutual-fund", async (req, res) => {
  const schemeCode = Number(req.query.schemeCode);
  if (!Number.isFinite(schemeCode)) {
    return res.status(400).json({ error: { code: "INVALID_SCHEME_CODE", message: "schemeCode is required" } });
  }
  try {
    const price = await fetchMutualFundNavByCode(schemeCode);
    if (price === null) {
      return res.status(404).json({ error: { code: "PRICE_NOT_FOUND", message: "No NAV available for this scheme" } });
    }
    res.json({ price });
  } catch {
    res.status(502).json({ error: { code: "QUOTE_FAILED", message: "Could not reach the price service. Try again in a moment." } });
  }
});

router.post("/", (req, res) => {
  const { name, platform, type, quantity, buyPrice, currentPrice, notes, symbol } = req.body ?? {};
  try {
    const investment = createInvestment(req.userId, {
      name,
      platform,
      type,
      quantity: Number(quantity),
      buyPrice: Number(buyPrice),
      currentPrice: Number(currentPrice),
      notes,
      symbol,
    });
    res.status(201).json(investment);
  } catch (err) {
    if (!handleInvestmentError(err, res)) throw err;
  }
});

router.post("/import/groww-mf", uploadSingleFile, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: "INVALID_FILE", message: "A file is required" } });
  }
  try {
    const { rows, skippedCount } = await parseGrowwMutualFundXlsx(req.file.buffer);
    const { importedCount, updatedCount } = importInvestments(req.userId, rows);
    res.status(201).json({
      investments: listInvestments(req.userId),
      summary: getInvestmentSummary(req.userId),
      importedCount,
      updatedCount,
      skippedCount,
    });
  } catch (err) {
    if (!handleInvestmentError(err, res)) {
      return res.status(400).json({
        error: { code: "XLSX_PARSE_FAILED", message: "Could not read this file. Make sure it's a Groww mutual fund holdings .xlsx export." },
      });
    }
  }
});

router.post("/import/groww-stocks", uploadSingleFile, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: "INVALID_FILE", message: "A file is required" } });
  }
  try {
    const { rows, skippedCount } = await parseGrowwStockHoldingsXlsx(req.file.buffer);
    const { importedCount, updatedCount } = importInvestments(req.userId, rows);
    res.status(201).json({
      investments: listInvestments(req.userId),
      summary: getInvestmentSummary(req.userId),
      importedCount,
      updatedCount,
      skippedCount,
    });
  } catch (err) {
    if (!handleInvestmentError(err, res)) {
      return res.status(400).json({
        error: { code: "XLSX_PARSE_FAILED", message: "Could not read this file. Make sure it's a Groww stock holdings .xlsx export." },
      });
    }
  }
});

router.post("/refresh-prices", async (req, res) => {
  try {
    const result = await refreshInvestmentPrices(req.userId);
    res.json(result);
  } catch (err) {
    if (!handleInvestmentError(err, res)) {
      return res.status(502).json({
        error: { code: "PRICE_REFRESH_FAILED", message: "Could not reach the price service. Try again in a moment." },
      });
    }
  }
});

router.patch("/:id", (req, res) => {
  const { name, platform, type, quantity, buyPrice, currentPrice, notes, symbol } = req.body ?? {};
  try {
    const investment = updateInvestment(req.userId, req.params.id, {
      name,
      platform,
      type,
      quantity: quantity !== undefined ? Number(quantity) : undefined,
      buyPrice: buyPrice !== undefined ? Number(buyPrice) : undefined,
      currentPrice: currentPrice !== undefined ? Number(currentPrice) : undefined,
      notes,
      symbol,
    });
    if (!investment) {
      return res.status(404).json({ error: { code: "INVESTMENT_NOT_FOUND", message: "Investment not found" } });
    }
    res.json(investment);
  } catch (err) {
    if (!handleInvestmentError(err, res)) throw err;
  }
});

router.delete("/:id", (req, res) => {
  const deleted = deleteInvestment(req.userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: { code: "INVESTMENT_NOT_FOUND", message: "Investment not found" } });
  }
  res.json({ success: true });
});

export default router;
