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
*/
import crypto from "node:crypto";
import * as L from "./logic.js";
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
} from "./http.js";

export const ADMIN_COOKIE = "ff_admin";
const SESSION_MS = 8 * 3600_000;
const MAX_SCORE = 1_000_000;
const LOGIN_FAILS = 8; // failed logins allowed per 15 minutes (per IP and per username)
const FAIL_WINDOW = 15 * 60_000;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const scrypt = (pw, salt) =>
  crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });

/* ---- users ---- */
export const cleanUsername = (u) =>
  typeof u === "string" && /^[a-zA-Z0-9._-]{2,32}$/.test(u.trim())
    ? u.trim().toLowerCase()
    : null;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scrypt(pw, salt).toString("hex")}`;
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));
function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "hex");
  const got = scrypt(pw, Buffer.from(salt, "hex"));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function addAdmin(db, username, password) {
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

export function removeAdmin(db, username) {
  const u = cleanUsername(username);
  return u ? db.prepare("delete from admins where username = ?").run(u).changes : 0;
}

/* ---- sessions ---- */
export function adminFromToken(db, token) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const s = db
    .prepare("select username, expires_at from admin_sessions where id = ?")
    .get(sha256(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare("delete from admin_sessions where id = ?").run(sha256(token));
    return null;
  }
  return s.username;
}

function log(db, username, action, details) {
  db.prepare("insert into admin_log (username, action, details, at) values (?, ?, ?, ?)").run(
    username,
    action,
    JSON.stringify(details),
    Date.now(),
  );
}

const publicRow = (r) => ({
  id: r.id,
  name: r.name,
  klass: r.klass,
  score: r.best,
  hidden: !!r.hidden,
  player: r.player_id !== null, // false = added by an admin
  achievedAt: r.achieved_at,
});
const validScore = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SCORE;

/* ---- the API ---- */
export async function handleAdmin(db, req) {
  if (req.method !== "POST") return fail(405, "method");
  if (!sameOrigin(req)) return fail(403, "origin");
  // only fetch() with JSON can send this; plain cross-site forms can't
  if (!(req.headers.get("content-type") || "").includes("application/json"))
    return fail(415, "json_only");
  const { body, error } = await readJson(req, 10_000);
  if (error) return fail(error, "bad_request");

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
    const row = u ? db.prepare("select * from admins where username = ?").get(u) : null;
    // always hash once, so a wrong username takes as long as a wrong password
    const ok = checkPassword(pw, row ? row.pass_hash : DUMMY_HASH) && !!row;
    if (!ok) {
      hit(ipKey);
      hit(userKey);
      return fail(401, "wrong_login");
    }
    db.prepare("delete from admin_sessions where expires_at < ?").run(now);
    const fresh = crypto.randomBytes(32).toString("base64url");
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
          `select * from leaderboard ${klass ? "where klass = ?" : ""}
           order by best desc, achieved_at asc limit 1000`,
        )
        .all(...(klass ? [klass] : []))
        .map(publicRow);
      return json(200, { rows });
    }

    case "add": {
      const name = L.cleanName(body.name);
      if (!name) return fail(400, "bad_name");
      if (!L.isClass(body.klass)) return fail(400, "bad_klass");
      if (!validScore(body.score)) return fail(400, "bad_score");
      const r = db
        .prepare(
          `insert into leaderboard (player_id, name, klass, best, achieved_at, updated_at)
           values (null, ?, ?, ?, ?, ?)`,
        )
        .run(name, body.klass, body.score, now, now);
      const row = db.prepare("select * from leaderboard where id = ?").get(r.lastInsertRowid);
      log(db, admin, "add", publicRow(row));
      return json(200, { row: publicRow(row) });
    }

    case "update": {
      const old = Number.isInteger(body.id)
        ? db.prepare("select * from leaderboard where id = ?").get(body.id)
        : null;
      if (!old) return fail(404, "not_found");
      const next = { ...old };
      if (body.name !== undefined) {
        next.name = L.cleanName(body.name);
        if (!next.name) return fail(400, "bad_name");
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
      db.prepare(
        "update leaderboard set name = ?, klass = ?, best = ?, hidden = ?, updated_at = ? where id = ?",
      ).run(next.name, next.klass, next.best, next.hidden, now, old.id);
      const row = db.prepare("select * from leaderboard where id = ?").get(old.id);
      log(db, admin, "update", { before: publicRow(old), after: publicRow(row) });
      return json(200, { row: publicRow(row) });
    }

    case "delete": {
      const old = Number.isInteger(body.id)
        ? db.prepare("select * from leaderboard where id = ?").get(body.id)
        : null;
      if (!old) return fail(404, "not_found");
      db.prepare("delete from leaderboard where id = ?").run(old.id);
      log(db, admin, "delete", publicRow(old));
      return json(200, {});
    }

    default:
      return fail(404, "not_found");
  }
}
