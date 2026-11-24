/*
  Player accounts for competition mode.

  Players make an account themselves: a unique username (to log in), a display
  name (shown on the leaderboard), a class and a password (at least 6 chars).
  Players can't change their password; only an admin can, on /admin.
  Normal mode doesn't need an account.

  Logging in gives an httpOnly cookie (ff_account). The database only stores
  a hash of it.
*/
import * as L from "./logic";
import type { DB, AccountRow, Count } from "./db";
import {
  sha256,
  cleanUsername,
  hashPassword,
  checkPassword,
  DUMMY_HASH,
  newToken,
  isToken,
} from "./password";

export const ACCOUNT_COOKIE = "ff_account";
export const ACCOUNT_SESSION_MS = 30 * 86_400_000; // 30 days, or until "Logg ut"
export const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;

export type PublicAccount = { username: string; displayName: string; klass: string };
export const publicAccount = (a: AccountRow): PublicAccount => ({
  username: a.username,
  displayName: a.display_name,
  klass: a.klass,
});

const validPassword = (p: unknown): p is string =>
  typeof p === "string" && p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD;

const getAccount = (db: DB, id: number) =>
  db.prepare("select * from accounts where id = ?").get(id) as AccountRow | undefined;

export function accountFromToken(db: DB, token: string | null | undefined): AccountRow | null {
  if (!isToken(token)) return null;
  const s = db
    .prepare("select account_id, expires_at from account_sessions where id = ?")
    .get(sha256(token)) as { account_id: number; expires_at: number } | undefined;
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare("delete from account_sessions where id = ?").run(sha256(token));
    return null;
  }
  return getAccount(db, s.account_id) ?? null;
}

// a new login session; returns the token for the cookie
export function startSession(db: DB, accountId: number, now: number): string {
  db.prepare("delete from account_sessions where expires_at < ?").run(now);
  const token = newToken();
  db.prepare("insert into account_sessions (id, account_id, expires_at) values (?, ?, ?)").run(
    sha256(token),
    accountId,
    now + ACCOUNT_SESSION_MS,
  );
  return token;
}

export function endSession(db: DB, token: string | null | undefined): void {
  if (isToken(token)) db.prepare("delete from account_sessions where id = ?").run(sha256(token));
}

export type RegisterError = "bad_username" | "bad_name" | "bad_klass" | "bad_password" | "taken";

export function register(
  db: DB,
  body: { username?: unknown; displayName?: unknown; klass?: unknown; password?: unknown },
  now: number,
): { error: RegisterError } | { error?: undefined; account: AccountRow } {
  const username = cleanUsername(body.username);
  if (!username) return { error: "bad_username" };
  const name = L.cleanName(body.displayName);
  if (!name) return { error: "bad_name" };
  if (!L.isClass(body.klass)) return { error: "bad_klass" };
  if (!validPassword(body.password)) return { error: "bad_password" };
  const r = db
    .prepare(
      `insert into accounts (username, display_name, klass, pass_hash, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?) on conflict (username) do nothing`,
    )
    .run(username, name, body.klass, hashPassword(body.password), now, now);
  if (r.changes === 0) return { error: "taken" };
  return { account: getAccount(db, Number(r.lastInsertRowid))! };
}

// null = wrong username or password (the same answer for both)
export function login(db: DB, username: unknown, password: unknown): AccountRow | null {
  const u = cleanUsername(username);
  const pw = typeof password === "string" ? password.slice(0, MAX_PASSWORD) : "";
  const row = u
    ? (db.prepare("select * from accounts where username = ?").get(u) as AccountRow | undefined)
    : undefined;
  // always hash once, so a wrong username takes as long as a wrong password
  const ok = checkPassword(pw, row ? row.pass_hash : DUMMY_HASH);
  return ok && row ? row : null;
}

/* ---- for admins (on /admin) ---- */

export type AdminAccount = PublicAccount & {
  id: number;
  createdAt: number;
  best: number | null; // best competition score, null = no score yet
};

export function listAccounts(db: DB): AdminAccount[] {
  const rows = db
    .prepare(
      `select a.*, l.best from accounts a
       left join leaderboard l on l.account_id = a.id
       order by a.username`,
    )
    .all() as (AccountRow & { best: number | null })[];
  return rows.map((a) => ({ ...publicAccount(a), id: a.id, createdAt: a.created_at, best: a.best }));
}

export type AccountUpdateError = "not_found" | "bad_name" | "bad_klass" | "bad_password";

// change display name, class and/or password. A new password logs the
// account out everywhere.
export function updateAccount(
  db: DB,
  id: unknown,
  changes: { displayName?: unknown; klass?: unknown; password?: unknown },
  now: number,
): { error: AccountUpdateError } | { error?: undefined; before: AccountRow; after: AccountRow } {
  const before = Number.isInteger(id) ? getAccount(db, id as number) : undefined;
  if (!before) return { error: "not_found" };
  const next = { ...before };
  if (changes.displayName !== undefined) {
    const name = L.cleanName(changes.displayName);
    if (!name) return { error: "bad_name" };
    next.display_name = name;
  }
  if (changes.klass !== undefined) {
    if (!L.isClass(changes.klass)) return { error: "bad_klass" };
    next.klass = changes.klass;
  }
  if (changes.password !== undefined) {
    if (!validPassword(changes.password)) return { error: "bad_password" };
    next.pass_hash = hashPassword(changes.password);
  }
  db.transaction(() => {
    db.prepare(
      "update accounts set display_name = ?, klass = ?, pass_hash = ?, updated_at = ? where id = ?",
    ).run(next.display_name, next.klass, next.pass_hash, now, before.id);
    // the leaderboard shows the account's name and class
    db.prepare("update leaderboard set name = ?, klass = ?, updated_at = ? where account_id = ?").run(
      next.display_name,
      next.klass,
      now,
      before.id,
    );
    if (changes.password !== undefined)
      db.prepare("delete from account_sessions where account_id = ?").run(before.id);
  })();
  return { before, after: getAccount(db, before.id)! };
}

// deletes the account, its sessions and its leaderboard row
export function deleteAccount(db: DB, id: unknown): AccountRow | null {
  const a = Number.isInteger(id) ? getAccount(db, id as number) : undefined;
  if (!a) return null;
  db.prepare("delete from accounts where id = ?").run(a.id);
  return a;
}

export const accountCount = (db: DB) =>
  (db.prepare("select count(*) as n from accounts").get() as Count).n;
