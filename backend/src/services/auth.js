import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "finflow-dev-secret-change-me";
const TOKEN_TTL = "7d";
const SCRYPT_KEYLEN = 64;

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

// Checks a payment/verification attempt against the account's UPI PIN.
// Returns null when authorized, or an { status, code, message } describing
// why it wasn't.
export function checkPinAuthorization(user, pin) {
  if (!user.upi_pin_hash) {
    return { status: 403, code: "PIN_NOT_SET", message: "Set a UPI PIN before making transfers" };
  }
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return { status: 400, code: "INVALID_PIN", message: "UPI PIN must be exactly 4 digits" };
  }
  if (!verifyPassword(pin, user.upi_pin_hash)) {
    return { status: 401, code: "INCORRECT_PIN", message: "Incorrect UPI PIN" };
  }
  return null;
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
