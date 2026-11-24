// Passwords and login tokens, shared by admin users and player accounts.
import crypto from "node:crypto";

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const scrypt = (pw: string, salt: Buffer) =>
  crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });

// usernames: 2-32 letters, digits, . _ - (stored in lower case)
export const cleanUsername = (u: unknown): string | null =>
  typeof u === "string" && /^[a-zA-Z0-9._-]{2,32}$/.test(u.trim())
    ? u.trim().toLowerCase()
    : null;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scrypt(pw, salt).toString("hex")}`;
}

// compared against when the username doesn't exist, so a wrong username takes
// as long as a wrong password (no way to find out which usernames exist)
export const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function checkPassword(pw: string, stored: string): boolean {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "hex");
  const got = scrypt(pw, Buffer.from(salt, "hex"));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// a random login token for a cookie (the database only stores its sha256)
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const isToken = (t: unknown): t is string =>
  typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
