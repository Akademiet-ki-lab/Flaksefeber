/*
  Admin: login and editing the leaderboard. Handles POST /api/admin.

  Admin users live in the `admins` table with scrypt-hashed passwords. They are
  added on the server with `npm run admin -- add-user <name>`, never from the web.
  Admin usernames have nothing to do with names on the leaderboard.

  Login gives an httpOnly, SameSite=Strict cookie that lasts 8 hours. The
  database only stores a hash of it.

  POST body: { action, ... }
    login  { username, password }      -> { username }
    logout                             -> {}
    me                                 -> { username }
    list   { klass? }                  -> { rows }       (hidden rows included)
    add    { name, klass, score }      -> { row }
    update { id, name?, klass?, score?, hidden? } -> { row }
    delete { id }                      -> {}
    accounts                           -> { accounts }   (player accounts for competition mode)
    account-update { id, displayName?, klass?, password? } -> { account }
    account-delete { id }              -> {}

  Only admins can change a player's password (players can't).
*/
import * as L from "./logic";
import {
  sha256,
  cleanUsername,
  hashPassword,
  checkPassword,
  DUMMY_HASH,
  newToken,
  isToken,
} from "./password";
import type { DB, LeaderboardRow, AdminRow, AdminSessionRow } from "./db";
import { listAccounts, updateAccount, deleteAccount, publicAccount } from "./accounts";
import {
  json,
  fail,
  readCookie,
  cookieHeader,
  clientIp,
  limited,
  hit,
  sameOrigin,
  readJson,
} from "./http";

export const ADMIN_COOKIE = "ff_admin";
const SESSION_MS = 8 * 3600_000;
const MAX_SCORE = 1_000_000;
const LOGIN_FAILS = 8; // failed logins allowed per 15 minutes (per IP and per username)
const FAIL_WINDOW = 15 * 60_000;

/* ---- users ---- */
export { cleanUsername, hashPassword };

export function addAdmin(db: DB, username: unknown, password: unknown): string {
  const u = cleanUsername(username);
  if (!u) throw new Error("Ugyldig brukernavn (2-32 tegn: bokstaver, tall, . _ -)");
  if (typeof password !== "string" || password.length < 10)
    throw new Error("Passordet må ha minst 10 tegn");
  db.prepare(
    `insert into admins (username, pass_hash, created_at) values (?, ?, ?)
     on conflict (username) do update set pass_hash = excluded.pass_hash`,
  ).run(u, hashPassword(password), Date.now());
  // a new password logs out every session for this user
  db.prepare("delete from admin_sessions where username = ?").run(u);
  return u;
}

export function removeAdmin(db: DB, username: unknown): number {
  const u = cleanUsername(username);
  return u ? db.prepare("delete from admins where username = ?").run(u).changes : 0;
}

/* ---- sessions ---- */
export function adminFromToken(db: DB, token: string | null | undefined): string | null {
  if (!isToken(token)) return null;
  const s = db
    .prepare("select username, expires_at from admin_sessions where id = ?")
    .get(sha256(token)) as Pick<AdminSessionRow, "username" | "expires_at"> | undefined;
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare("delete from admin_sessions where id = ?").run(sha256(token));
    return null;
  }
  return s.username;
}

function log(db: DB, username: string, action: string, details: unknown): void {
  db.prepare("insert into admin_log (username, action, details, at) values (?, ?, ?, ?)").run(
    username,
    action,
    JSON.stringify(details),
    Date.now(),
  );
}

export type AdminLeaderboardRow = {
  id: number;
  name: string;
  klass: string;
  score: number;
  hidden: boolean;
  account: string | null; // username of the player's account; null = added by an admin
  achievedAt: number;
};

type RowWithUser = LeaderboardRow & { username?: string | null };
const publicRow = (r: RowWithUser): AdminLeaderboardRow => ({
  id: r.id,
  name: r.name,
  klass: r.klass,
  score: r.best,
  hidden: !!r.hidden,
  account: r.account_id !== null ? (r.username ?? "?") : null,
  achievedAt: r.achieved_at,
});
const validScore = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SCORE;

const getRow = (db: DB, id: unknown): RowWithUser | undefined =>
  Number.isInteger(id) || typeof id === "bigint"
    ? (db
        .prepare(
          `select l.*, a.username from leaderboard l
           left join accounts a on a.id = l.account_id where l.id = ?`,
        )
        .get(id) as RowWithUser | undefined)
    : undefined;

const ACCOUNT_ERRORS = {
  not_found: 404,
  bad_name: 400,
  bad_klass: 400,
  bad_password: 400,
} as const;

/* ---- the API ---- */
export async function handleAdmin(db: DB, req: Request): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method");
  if (!sameOrigin(req)) return fail(403, "origin");
  // only fetch() with JSON can send this; plain cross-site forms can't
  if (!(req.headers.get("content-type") || "").includes("application/json"))
    return fail(415, "json_only");
  const { body, error } = await readJson(req, 10_000);
  if (error !== undefined) return fail(error, "bad_request");

  const now = Date.now();
  const token = readCookie(req, ADMIN_COOKIE);

  if (body.action === "login") {
    const ipKey = "login-ip:" + clientIp(req);
    const u = cleanUsername(body.username);
    const userKey = "login-user:" + (u || "?");
    if (
      limited(ipKey, LOGIN_FAILS, FAIL_WINDOW, { count: false }) ||
      limited(userKey, LOGIN_FAILS, FAIL_WINDOW, { count: false })
    )
      return fail(429, "rate");
    const pw = typeof body.password === "string" ? body.password.slice(0, 200) : "";
    const row = u
      ? (db.prepare("select * from admins where username = ?").get(u) as AdminRow | undefined)
      : undefined;
    // always hash once, so a wrong username takes as long as a wrong password
    const ok = checkPassword(pw, row ? row.pass_hash : DUMMY_HASH) && !!row && !!u;
    if (!ok) {
      hit(ipKey);
      hit(userKey);
      return fail(401, "wrong_login");
    }
    db.prepare("delete from admin_sessions where expires_at < ?").run(now);
    const fresh = newToken();
    db.prepare("insert into admin_sessions (id, username, expires_at) values (?, ?, ?)").run(
      sha256(fresh),
      u,
      now + SESSION_MS,
    );
    log(db, u, "login", {});
    return json(
      200,
      { username: u },
      {
        "Set-Cookie": cookieHeader(req, ADMIN_COOKIE, fresh, {
          maxAge: SESSION_MS / 1000,
          sameSite: "Strict",
        }),
      },
    );
  }

  const admin = adminFromToken(db, token);
  if (body.action === "logout") {
    if (token) db.prepare("delete from admin_sessions where id = ?").run(sha256(token));
    return json(200, {}, {
      "Set-Cookie": cookieHeader(req, ADMIN_COOKIE, "", { maxAge: 0, sameSite: "Strict" }),
    });
  }
  if (!admin) return fail(401, "not_logged_in");

  switch (body.action) {
    case "me":
      return json(200, { username: admin });

    case "list": {
      const klass = L.isClass(body.klass) ? body.klass : null;
      const rows = db
        .prepare(
          `select l.*, a.username from leaderboard l
           left join accounts a on a.id = l.account_id
           ${klass ? "where l.klass = ?" : ""}
           order by l.best desc, l.achieved_at asc limit 1000`,
        )
        .all(...(klass ? [klass] : []))
        .map((r) => publicRow(r as RowWithUser));
      return json(200, { rows });
    }

    case "add": {
      const name = L.cleanName(body.name);
      if (!name) return fail(400, "bad_name");
      if (!L.isClass(body.klass)) return fail(400, "bad_klass");
      if (!validScore(body.score)) return fail(400, "bad_score");
      const r = db
        .prepare(
          `insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at)
           values (null, ?, ?, ?, ?, ?)`,
        )
        .run(name, body.klass, body.score, now, now);
      const row = getRow(db, r.lastInsertRowid)!;
      log(db, admin, "add", publicRow(row));
      return json(200, { row: publicRow(row) });
    }

    case "update": {
      const old = getRow(db, body.id);
      if (!old) return fail(404, "not_found");
      const next = { ...old };
      if (body.name !== undefined) {
        const name = L.cleanName(body.name);
        if (!name) return fail(400, "bad_name");
        next.name = name;
      }
      if (body.klass !== undefined) {
        if (!L.isClass(body.klass)) return fail(400, "bad_klass");
        next.klass = body.klass;
      }
      if (body.score !== undefined) {
        if (!validScore(body.score)) return fail(400, "bad_score");
        next.best = body.score;
      }
      if (body.hidden !== undefined) next.hidden = body.hidden ? 1 : 0;
      db.transaction(() => {
        db.prepare(
          "update leaderboard set name = ?, klass = ?, best = ?, hidden = ?, updated_at = ? where id = ?",
        ).run(next.name, next.klass, next.best, next.hidden, now, old.id);
        // a player's row shows their account's name and class: change both
        if (old.account_id !== null)
          db.prepare("update accounts set display_name = ?, klass = ?, updated_at = ? where id = ?").run(
            next.name,
            next.klass,
            now,
            old.account_id,
          );
      })();
      const row = getRow(db, old.id)!;
      log(db, admin, "update", { before: publicRow(old), after: publicRow(row) });
      return json(200, { row: publicRow(row) });
    }

    case "delete": {
      const old = getRow(db, body.id);
      if (!old) return fail(404, "not_found");
      db.prepare("delete from leaderboard where id = ?").run(old.id);
      log(db, admin, "delete", publicRow(old));
      return json(200, {});
    }

    case "accounts":
      return json(200, { accounts: listAccounts(db) });

    case "account-update": {
      const r = updateAccount(
        db,
        body.id,
        { displayName: body.displayName, klass: body.klass, password: body.password },
        now,
      );
      if (r.error) return fail(ACCOUNT_ERRORS[r.error], r.error);
      // never log the password itself
      log(db, admin, "account-update", {
        username: r.after.username,
        before: { displayName: r.before.display_name, klass: r.before.klass },
        after: { displayName: r.after.display_name, klass: r.after.klass },
        newPassword: body.password !== undefined,
      });
      return json(200, { account: { ...publicAccount(r.after), id: r.after.id } });
    }

    case "account-delete": {
      const a = deleteAccount(db, body.id);
      if (!a) return fail(404, "not_found");
      log(db, admin, "account-delete", publicAccount(a));
      return json(200, {});
    }

    default:
      return fail(404, "not_found");
  }
}
