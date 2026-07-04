import { Router } from "express";
import {
  deleteBudgetCategory,
  isValidBudgetCategoryName,
  listBudgets,
  listBudgetCategories,
  upsertBudgets,
} from "../config/database.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json({
    categories: listBudgetCategories(req.userId),
    budgets: listBudgets(req.userId),
  });
});

router.put("/", (req, res) => {
  const { budgets } = req.body ?? {};
  if (!Array.isArray(budgets) || budgets.length === 0) {
    return res.status(400).json({
      error: { code: "INVALID_BUDGETS", message: "budgets must be a non-empty array" },
    });
  }

  const seenCategories = new Set();
  for (const budget of budgets) {
    if (
      !budget ||
      !isValidBudgetCategoryName(budget.category) ||
      !Number.isSafeInteger(budget.monthlyLimit) ||
      budget.monthlyLimit < 0
    ) {
      return res.status(400).json({
        error: { code: "INVALID_BUDGET", message: "Each budget needs a valid category and non-negative monthlyLimit" },
      });
    }
    if (
      budget.thresholdPercent !== undefined &&
      (!Number.isSafeInteger(budget.thresholdPercent) || budget.thresholdPercent < 1 || budget.thresholdPercent > 100)
    ) {
      return res.status(400).json({
        error: { code: "INVALID_THRESHOLD", message: "thresholdPercent must be between 1 and 100" },
      });
    }
    const normalizedCategory = budget.category.trim().toLowerCase();
    if (seenCategories.has(normalizedCategory)) {
      return res.status(400).json({
        error: { code: "DUPLICATE_CATEGORY", message: `Category "${budget.category}" is listed more than once` },
      });
    }
    seenCategories.add(normalizedCategory);
  }

  // Order matters: upsert first so the category list computed below reflects
  // any brand-new category this call just created (object literal properties
  // evaluate top-to-bottom, so listBudgetCategories must run second).
  const updatedBudgets = upsertBudgets(req.userId, budgets);
  res.json({
    categories: listBudgetCategories(req.userId),
    budgets: updatedBudgets,
  });
});

router.delete("/:category", (req, res) => {
  const { category } = req.params;
  if (!isValidBudgetCategoryName(category)) {
    return res.status(400).json({
      error: { code: "INVALID_BUDGET", message: "category must be a valid budgeting category name" },
    });
  }

  deleteBudgetCategory(req.userId, category);
  res.json({
    categories: listBudgetCategories(req.userId),
    budgets: listBudgets(req.userId),
  });
});

export default router;
