import { Router } from "express";
import { searchUsers } from "../config/database.js";
import { requireAuth } from "../services/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length === 0) {
    return res.json([]);
  }
  const results = searchUsers(q, req.userId).map((u) => ({ ...u, isSelf: u.id === req.userId }));
  res.json(results);
});

export default router;
