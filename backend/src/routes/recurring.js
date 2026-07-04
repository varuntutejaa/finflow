import { Router } from "express";
import {
  createRecurringPayment,
  listRecurringPayments,
  cancelRecurringPayment,
  RecurringPaymentError,
} from "../config/recurringDatabase.js";
import { getUserRawById } from "../config/database.js";
import { requireAuth, checkPinAuthorization } from "../services/auth.js";
import { asyncHandler } from "../services/asyncHandler.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listRecurringPayments(req.userId));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { fromAccountId, toUsername, amount, category, frequency, startAt, pin } = req.body ?? {};

    const user = await getUserRawById(req.userId);
    if (!user) {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    // A recurring mandate is authorized once, with the PIN, at setup time —
    // every automatic run afterward reuses that authorization instead of
    // asking for the PIN again (see recurringDatabase.js).
    const authError = await checkPinAuthorization(user, pin);
    if (authError) {
      return res.status(authError.status).json({
        error: {
          code: authError.code,
          message: authError.message,
          unlockAt: authError.unlockAt,
          attemptsRemaining: authError.attemptsRemaining,
        },
      });
    }

    try {
      const recurringPayment = await createRecurringPayment({
        userId: req.userId,
        fromAccountId,
        toUsername,
        amount,
        category,
        frequency,
        startAt,
      });
      res.status(201).json(recurringPayment);
    } catch (err) {
      if (err instanceof RecurringPaymentError) {
        return res.status(err.status).json({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const cancelled = await cancelRecurringPayment(req.userId, req.params.id);
    if (!cancelled) {
      return res.status(404).json({ error: { code: "RECURRING_NOT_FOUND", message: "Recurring payment not found" } });
    }
    res.json({ success: true, action: cancelled.action });
  })
);

export default router;
