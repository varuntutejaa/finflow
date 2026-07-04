import { Router } from "express";
import { computeSpendingAnalytics } from "../config/importDatabase.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/spending", (req, res) => {
  const { dateFrom, dateTo } = req.query;
  res.json(
    computeSpendingAnalytics(req.userId, {
      dateFrom: typeof dateFrom === "string" ? dateFrom : undefined,
      dateTo: typeof dateTo === "string" ? dateTo : undefined,
    })
  );
});

export default router;
