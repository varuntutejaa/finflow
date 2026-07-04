import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { recordFailedPinAttempt, listFailedPinAttempts, clearFailedPinAttempts } from "../config/database.js";

const isProduction = process.env.NODE_ENV === "production";
const TOKEN_TTL = "7d";
const SCRYPT_KEYLEN = 64;

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to at least 32 characters when NODE_ENV=production");
}

const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString("hex");

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const PIN_RE = /^\d{4}$/;
const PIN_LOCKOUT_THRESHOLD = 5;
const PIN_LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000;

// Checks a payment/verification attempt against the account's UPI PIN.
// Returns null when authorized, or an { status, code, message } describing
// why it wasn't. Five wrong PINs in a row (across any PIN-gated action)
// locks the account for 24 hours — a correct PIN resets the streak, and the
// streak itself is cleared once the lockout window has fully elapsed, so a
// stale lockout never blocks a fresh set of 5 attempts.
export async function checkPinAuthorization(user, pin) {
  let failedAttempts = await listFailedPinAttempts(user.id); // newest first
  if (failedAttempts.length >= PIN_LOCKOUT_THRESHOLD) {
    const unlockAt = failedAttempts[0] + PIN_LOCKOUT_DURATION_MS;
    if (Date.now() < unlockAt) {
      const unlockAtIso = new Date(unlockAt).toISOString();
      return {
        status: 423,
        code: "ACCOUNT_LOCKED",
        message: `Too many incorrect PIN attempts. Try again after ${new Date(unlockAt).toLocaleString()}.`,
        unlockAt: unlockAtIso,
      };
    }
    await clearFailedPinAttempts(user.id);
    failedAttempts = [];
  }

  if (!user.upi_pin_hash) {
    return { status: 403, code: "PIN_NOT_SET", message: "Set a UPI PIN before making transfers" };
  }
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return { status: 400, code: "INVALID_PIN", message: "UPI PIN must be exactly 4 digits" };
  }
  if (!verifyPassword(pin, user.upi_pin_hash)) {
    await recordFailedPinAttempt(user.id);
    const remaining = Math.max(0, PIN_LOCKOUT_THRESHOLD - (failedAttempts.length + 1));
    const message =
      remaining > 0
        ? `Incorrect UPI PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} left before your account is locked for 24 hours.`
        : "Incorrect UPI PIN. Your account is now locked for 24 hours.";
    return { status: 401, code: "INCORRECT_PIN", message, attemptsRemaining: remaining };
  }
  await clearFailedPinAttempts(user.id);
  return null;
}

// Read-only lockout check — lets the UI show "locked for 24h" proactively
// (e.g. right on the dashboard) instead of only after the next failed
// attempt. Mirrors checkPinAuthorization's lockout window exactly, but
// never records or consumes an attempt.
export async function getPinLockoutStatus(userId) {
  const failedAttempts = await listFailedPinAttempts(userId);
  if (failedAttempts.length < PIN_LOCKOUT_THRESHOLD) {
    return { locked: false, unlockAt: null };
  }
  const unlockAt = failedAttempts[0] + PIN_LOCKOUT_DURATION_MS;
  if (Date.now() >= unlockAt) {
    return { locked: false, unlockAt: null };
  }
  return { locked: true, unlockAt: new Date(unlockAt).toISOString() };
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing bearer token" } });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
  }
}
