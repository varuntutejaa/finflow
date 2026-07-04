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

const router = Router();
router.use(requireAuth);

function handleSplitError(err, res) {
  if (err instanceof SplitError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

router.get("/", (req, res) => {
  res.json(listExpenseGroups(req.userId));
});

router.post("/", (req, res) => {
  const { name, memberUsernames } = req.body ?? {};
  try {
    res.status(201).json(createExpenseGroup(req.userId, { name, memberUsernames }));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.get("/:id", (req, res) => {
  try {
    res.json(getExpenseGroupDetail(req.params.id, req.userId));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.post("/:id/members", (req, res) => {
  const { username } = req.body ?? {};
  try {
    res.json(addGroupMember(req.params.id, req.userId, username));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.delete("/:id/members/:username", (req, res) => {
  try {
    res.json(removeGroupMember(req.params.id, req.userId, req.params.username));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.post("/:id/expenses", (req, res) => {
  const { description, amount, paidByUsername, splitType, participantUsernames, customSplits } = req.body ?? {};
  try {
    const group = addExpense(req.params.id, req.userId, {
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
});

router.post("/:id/settlements/generate", (req, res) => {
  try {
    res.json(generateSettlements(req.params.id, req.userId));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.post("/:id/settlements/:settlementId/pay", (req, res) => {
  const { amount, transactionId } = req.body ?? {};
  try {
    res.json(recordSettlementPayment(req.params.id, req.params.settlementId, req.userId, { amount, transactionId }));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

router.patch("/:id/settlements/:settlementId", (req, res) => {
  const { status } = req.body ?? {};
  if (status !== "paid") {
    return res.status(400).json({ error: { code: "INVALID_STATUS", message: 'status must be "paid"' } });
  }
  try {
    res.json(markSettlementPaid(req.params.id, req.params.settlementId, req.userId));
  } catch (err) {
    if (!handleSplitError(err, res)) throw err;
  }
});

export default router;
