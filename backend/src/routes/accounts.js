import { Router } from "express";
import { listAccounts, createAccount, getAccount } from "../config/database.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(listAccounts(req.userId));
});

router.post("/", (req, res) => {
  const { accountName, balance } = req.body ?? {};
  if (typeof accountName !== "string" || accountName.trim().length === 0) {
    return res.status(400).json({ error: { code: "INVALID_NAME", message: "accountName is required" } });
  }
  if (balance !== undefined && (!Number.isSafeInteger(balance) || balance < 0)) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_BALANCE", message: "balance must be a non-negative integer (cents)" } });
  }
  const account = createAccount({ userId: req.userId, accountName: accountName.trim(), balance: balance ?? 0 });
  res.status(201).json(account);
});

router.get("/:id", (req, res) => {
  const account = getAccount(req.params.id, req.userId);
  if (!account) {
    return res.status(404).json({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found" } });
  }
  res.json(account);
});

export default router;
