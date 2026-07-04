import { Router } from "express";
import {
  createExpenseGroup,
  listExpenseGroups,
  getExpenseGroupDetail,
  addGroupMember,
  removeGroupMember,
  addExpense,
  generateSettlements,
  markSettlementPaid,
  recordSettlementPayment,
  SplitError,
} from "../config/splitDatabase.js";
import { requireAuth } from "../services/auth.js";
import { asyncHandler } from "../services/asyncHandler.js";

const router = Router();
router.use(requireAuth);

function handleSplitError(err, res) {
  if (err instanceof SplitError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listExpenseGroups(req.userId));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, memberUsernames } = req.body ?? {};
    try {
      res.status(201).json(await createExpenseGroup(req.userId, { name, memberUsernames }));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      res.json(await getExpenseGroupDetail(req.params.id, req.userId));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const { username } = req.body ?? {};
    try {
      res.json(await addGroupMember(req.params.id, req.userId, username));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.delete(
  "/:id/members/:username",
  asyncHandler(async (req, res) => {
    try {
      res.json(await removeGroupMember(req.params.id, req.userId, req.params.username));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.post(
  "/:id/expenses",
  asyncHandler(async (req, res) => {
    const { description, amount, paidByUsername, splitType, participantUsernames, customSplits } = req.body ?? {};
    try {
      const group = await addExpense(req.params.id, req.userId, {
        description,
        amount,
        paidByUsername,
        splitType,
        participantUsernames,
        customSplits,
      });
      res.status(201).json(group);
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.post(
  "/:id/settlements/generate",
  asyncHandler(async (req, res) => {
    try {
      res.json(await generateSettlements(req.params.id, req.userId));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.post(
  "/:id/settlements/:settlementId/pay",
  asyncHandler(async (req, res) => {
    const { amount, transactionId } = req.body ?? {};
    try {
      res.json(await recordSettlementPayment(req.params.id, req.params.settlementId, req.userId, { amount, transactionId }));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

router.patch(
  "/:id/settlements/:settlementId",
  asyncHandler(async (req, res) => {
    const { status } = req.body ?? {};
    if (status !== "paid") {
      return res.status(400).json({ error: { code: "INVALID_STATUS", message: 'status must be "paid"' } });
    }
    try {
      res.json(await markSettlementPaid(req.params.id, req.params.settlementId, req.userId));
    } catch (err) {
      if (!handleSplitError(err, res)) throw err;
    }
  })
);

export default router;
