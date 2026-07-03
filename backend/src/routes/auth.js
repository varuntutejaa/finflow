import { Router } from "express";
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  getUserById,
  getUserRawById,
  setUserPin,
} from "../config/database.js";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../services/auth.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PIN_RE = /^\d{4}$/;

router.post("/signup", (req, res) => {
  const { username, email, password, name } = req.body ?? {};

  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: {
        code: "INVALID_USERNAME",
        message: "Username must be 3-20 characters: letters, numbers, underscores",
      },
    });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: { code: "INVALID_EMAIL", message: "A valid email is required" } });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_PASSWORD", message: "Password must be at least 8 characters" } });
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: { code: "INVALID_NAME", message: "name is required" } });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  if (findUserByUsername(normalizedUsername)) {
    return res.status(409).json({ error: { code: "USERNAME_TAKEN", message: "That username is already taken" } });
  }
  if (findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "An account with that email already exists" } });
  }

  // No UPI PIN yet — set via POST /api/auth/pin once the user is authenticated,
  // right after signup completes.
  const user = createUser({
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    upiPinHash: null,
    name: name.trim(),
  });
  const token = signToken(user.id);
  res.status(201).json({ user, token, needsPinSetup: true });
});

// Live username availability check used by the signup form. Returns whether the
// format is valid and whether the (normalized) username is still free.
router.get("/check-username", (req, res) => {
  const raw = typeof req.query.username === "string" ? req.query.username.trim() : "";
  if (!USERNAME_RE.test(raw)) {
    return res.json({
      valid: false,
      available: false,
      message: "3-20 characters: letters, numbers, underscores",
    });
  }
  const available = !findUserByUsername(raw.toLowerCase());
  res.json({
    valid: true,
    available,
    message: available ? "Username is available" : "That username is already taken",
  });
});

router.post("/login", (req, res) => {
  const { identifier, password } = req.body ?? {};
  if (typeof identifier !== "string" || typeof password !== "string" || identifier.trim().length === 0) {
    return res
      .status(400)
      .json({ error: { code: "INVALID_CREDENTIALS", message: "identifier and password are required" } });
  }

  const normalized = identifier.trim().toLowerCase();
  const row = normalized.includes("@") ? findUserByEmail(normalized) : findUserByUsername(normalized);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res
      .status(401)
      .json({ error: { code: "INVALID_CREDENTIALS", message: "Incorrect email/username or password" } });
  }

  const token = signToken(row.id);
  res.json({
    user: { id: row.id, username: row.username, email: row.email, name: row.name, createdAt: row.created_at },
    token,
  });
});

router.post("/pin", requireAuth, (req, res) => {
  const { pin, pinConfirm } = req.body ?? {};

  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return res.status(400).json({ error: { code: "INVALID_PIN", message: "UPI PIN must be exactly 4 digits" } });
  }
  if (pin !== pinConfirm) {
    return res.status(400).json({ error: { code: "PIN_MISMATCH", message: "PINs do not match" } });
  }

  setUserPin(req.userId, hashPassword(pin));
  res.json({ success: true });
});

// Verifies the caller's UPI PIN without performing any action — used to unlock
// hidden balances.
router.post("/verify-pin", requireAuth, (req, res) => {
  const { pin } = req.body ?? {};
  const user = getUserRawById(req.userId);

  if (!user.upi_pin_hash) {
    return res.status(403).json({ error: { code: "PIN_NOT_SET", message: "No UPI PIN set for this account" } });
  }
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return res.status(400).json({ error: { code: "INVALID_PIN", message: "UPI PIN must be exactly 4 digits" } });
  }
  if (!verifyPassword(pin, user.upi_pin_hash)) {
    return res.status(401).json({ error: { code: "INCORRECT_PIN", message: "Incorrect UPI PIN" } });
  }
  res.json({ valid: true });
});

router.get("/me", requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }
  res.json(user);
});

export default router;
