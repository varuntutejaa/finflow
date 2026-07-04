import { Router } from "express";
import { computeSpendingAnalytics } from "../config/importDatabase.js";
import { requireAuth } from "../services/auth.js";
import { asyncHandler } from "../services/asyncHandler.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/spending",
  asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.query;
    res.json(
      await computeSpendingAnalytics(req.userId, {
        dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
        dateTo: typeof dateTo === "string" ? dateTo : undefined,
      })
    );
  })
);

export default router;
