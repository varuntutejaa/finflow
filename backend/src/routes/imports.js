import { Router } from "express";
import fs from "fs";
import fsp from "fs/promises";
import multer from "multer";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
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
import { asyncHandler } from "../services/asyncHandler.js";

const router = Router();
router.use(requireAuth);

const uploadDir = path.join(os.tmpdir(), "finflow-statement-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

// Multipart uploads are spooled to disk rather than memory. That keeps a
// burst of large statement uploads from competing for V8 heap before parsing.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 12);
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await fsp.unlink(file.path).catch(() => {});
}

function handleImportError(err, res) {
  if (err instanceof ImportError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category, dateFrom, dateTo } = req.query;
    res.json(
      await listImportedTransactions(req.userId, {
        category: typeof category === "string" ? category : undefined,
        dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
        dateTo: typeof dateTo === "string" ? dateTo : undefined,
      })
    );
  })
);

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

router.post(
  "/csv",
  uploadStatementFile("csv", "INVALID_CSV", "CSV is too large (max 15MB)"),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: { code: "INVALID_CSV", message: "A csv file is required" } });
      }
      const csvText = await fsp.readFile(req.file.path, "utf8");
      if (!csvText.trim()) {
        return res.status(400).json({ error: { code: "INVALID_CSV", message: "The csv file is empty" } });
      }
      const { rows, skippedCount } = parseCsvStatement(csvText);
      const { batchId, imported, duplicateCount } = await importTransactions(req.userId, "csv", rows);
      res.status(201).json({ imported, importedCount: imported.length, skippedCount, duplicateCount, batchId });
    } catch (err) {
      if (!handleImportError(err, res)) throw err;
    } finally {
      await removeUploadedFile(req.file);
    }
  })
);

router.post(
  "/pdf",
  uploadStatementFile("pdf", "INVALID_PDF", "PDF is too large (max 15MB)"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: { code: "INVALID_PDF", message: "A pdf file is required" } });
    }

    try {
      const parser = new PDFParse({ url: req.file.path });
      const { text } = await parser.getText();
      await parser.destroy();

      const { rows, skippedCount } = parsePdfStatementText(text);
      const { batchId, imported, duplicateCount } = await importTransactions(req.userId, "pdf", rows);
      res.status(201).json({ imported, importedCount: imported.length, skippedCount, duplicateCount, batchId });
    } catch (err) {
      if (!handleImportError(err, res)) {
        return res.status(400).json({
          error: { code: "PDF_PARSE_FAILED", message: "Could not read this PDF. Make sure it's a text-based (not scanned) PDF." },
        });
      }
    } finally {
      await removeUploadedFile(req.file);
    }
  })
);

router.delete(
  "/batch/:batchId",
  asyncHandler(async (req, res) => {
    const deletedCount = await deleteImportBatch(req.userId, req.params.batchId);
    if (deletedCount === 0) {
      return res.status(404).json({ error: { code: "IMPORT_BATCH_NOT_FOUND", message: "Nothing to undo for this import" } });
    }
    res.json({ success: true, deletedCount });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { category } = req.body ?? {};
    if (!isValidBudgetCategoryName(category)) {
      return res.status(400).json({
        error: { code: "INVALID_CATEGORY", message: "category must be a valid budgeting category name" },
      });
    }
    const updated = await updateImportedTransactionCategory(req.userId, req.params.id, category);
    if (!updated) {
      return res.status(404).json({ error: { code: "IMPORTED_TX_NOT_FOUND", message: "Imported transaction not found" } });
    }
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const deleted = await deleteImportedTransaction(req.userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: { code: "IMPORTED_TX_NOT_FOUND", message: "Imported transaction not found" } });
    }
    res.json({ success: true });
  })
);

export default router;
