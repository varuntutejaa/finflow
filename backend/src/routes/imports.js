import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import {
  parseCsvStatement,
  parsePdfStatementText,
  importTransactions,
  listImportedTransactions,
  updateImportedTransactionCategory,
  deleteImportedTransaction,
  deleteImportBatch,
  ImportError,
} from "../config/importDatabase.js";
import { isValidBudgetCategoryName } from "../config/database.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

// Streamed straight to memory as multipart/form-data — never buffered as a
// base64 string inside the JSON body, which would triple the payload size
// and block the event loop parsing a giant JSON string synchronously.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function handleImportError(err, res) {
  if (err instanceof ImportError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

router.get("/", (req, res) => {
  const { category, dateFrom, dateTo } = req.query;
  res.json(
    listImportedTransactions(req.userId, {
      category: typeof category === "string" ? category : undefined,
      dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
      dateTo: typeof dateTo === "string" ? dateTo : undefined,
    })
  );
});

function uploadStatementFile(fieldName, invalidCode, maxSizeMessage) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? maxSizeMessage : "Could not read the uploaded file";
        return res.status(400).json({ error: { code: invalidCode, message } });
      }
      next();
    });
  };
}

router.post("/csv", uploadStatementFile("csv", "INVALID_CSV", "CSV is too large (max 15MB)"), (req, res) => {
  // Keep a tiny legacy fallback for older frontend builds, but the normal
  // production path is multipart/form-data with req.file.
  const csvText = req.file?.buffer?.toString("utf8") ?? req.body?.csvText;
  if (typeof csvText !== "string" || !csvText.trim()) {
    return res.status(400).json({ error: { code: "INVALID_CSV", message: "A csv file is required" } });
  }
  try {
    const { rows, skippedCount } = parseCsvStatement(csvText);
    const { batchId, imported, duplicateCount } = importTransactions(req.userId, "csv", rows);
    res.status(201).json({ imported, importedCount: imported.length, skippedCount, duplicateCount, batchId });
  } catch (err) {
    if (!handleImportError(err, res)) throw err;
  }
});

router.post("/pdf", uploadStatementFile("pdf", "INVALID_PDF", "PDF is too large (max 15MB)"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: "INVALID_PDF", message: "A pdf file is required" } });
  }

  try {
    const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    const { text } = await parser.getText();
    await parser.destroy();

    const { rows, skippedCount } = parsePdfStatementText(text);
    const { batchId, imported, duplicateCount } = importTransactions(req.userId, "pdf", rows);
    res.status(201).json({ imported, importedCount: imported.length, skippedCount, duplicateCount, batchId });
  } catch (err) {
    if (!handleImportError(err, res)) {
      return res.status(400).json({
        error: { code: "PDF_PARSE_FAILED", message: "Could not read this PDF. Make sure it's a text-based (not scanned) PDF." },
      });
    }
  }
});

router.delete("/batch/:batchId", (req, res) => {
  const deletedCount = deleteImportBatch(req.userId, req.params.batchId);
  if (deletedCount === 0) {
    return res.status(404).json({ error: { code: "IMPORT_BATCH_NOT_FOUND", message: "Nothing to undo for this import" } });
  }
  res.json({ success: true, deletedCount });
});

router.patch("/:id", (req, res) => {
  const { category } = req.body ?? {};
  if (!isValidBudgetCategoryName(category)) {
    return res.status(400).json({
      error: { code: "INVALID_CATEGORY", message: "category must be a valid budgeting category name" },
    });
  }
  const updated = updateImportedTransactionCategory(req.userId, req.params.id, category);
  if (!updated) {
    return res.status(404).json({ error: { code: "IMPORTED_TX_NOT_FOUND", message: "Imported transaction not found" } });
  }
  res.json(updated);
});

router.delete("/:id", (req, res) => {
  const deleted = deleteImportedTransaction(req.userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: { code: "IMPORTED_TX_NOT_FOUND", message: "Imported transaction not found" } });
  }
  res.json({ success: true });
});

export default router;
