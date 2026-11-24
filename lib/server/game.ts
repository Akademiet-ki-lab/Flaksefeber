/*
  Flaksefeber backend: handles POST /api/game.

  The browser never writes progress. It sends flaps; the server replays the run
  with the shared simulation (sim.ts) and writes the result itself.

  Who is playing:
  - every browser gets a random token in an httpOnly cookie (ff_player). That
    is enough for normal mode: progress, XP and unlocks.
  - competition mode also needs a logged-in account (ff_account cookie), see
    accounts.ts. The leaderboard belongs to accounts, so the same player keeps
    their best score on any device.
  JavaScript in the page can't read either cookie, and the database only
  stores their sha256 hashes.

  POST body: { action, ... }
    session                      -> { progress, account }
    select    { arena, skin }    -> { progress }
    account-register { username, displayName, klass, password } -> { account }
    account-login    { username, password }                     -> { account }
    account-logout                                               -> {}
    run-start { arena }          -> { runId, seed }
    run-start { mode: "comp" }   -> { runId, seed }   (competition run: needs an account)
    run-finish{ runId, inputs, frames } -> { progress, result }   (normal)
    run-finish{ runId, inputs, frames } -> { result }             (competition)
    leaderboard { klass? }       -> { rows, me }
*/
import crypto from "node:crypto";
import * as L from "./logic";
import type { DB, PlayerRow, RunRow, LeaderboardRow, Count, AccountRow } from "./db";
import {
  json,
  readCookie,
  cookieHeader,
  clientIp,
  limited,
  hit,
  sameOrigin,
  readJson,
} from "./http";
import { sha256, newToken, isToken } from "./password";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_SESSION_MS,
  accountFromToken,
  startSession,
  endSession,
  register,
  login,
  publicAccount,
} from "./accounts";

const COOKIE = "ff_player";
const COOKIE_MAX_AGE = 5 * 365 * 86400; // seconds
const MAX_BODY = 2_000_000; // bytes; a 30-minute competition run is well below this
const RUNS_PER_MINUTE = 30;
// per 10 minutes and IP (a whole school can share one IP)
const NEW_PLAYERS_PER_IP = 200;
const NEW_ACCOUNTS_PER_IP = 200;
// failed logins per 15 minutes: few per username, more per IP (shared school IP)
const LOGIN_FAILS_PER_USER = 8;
const LOGIN_FAILS_PER_IP = 100;
const FAIL_WINDOW = 15 * 60_000;

function rowToProgress(r: PlayerRow): L.Progress {
  return {
    bests: JSON.parse(r.bests),
    arenas: r.arenas,
    arena: r.arena,
    xp: r.xp,
    skin: r.skin,
    seq: r.seq,
  };
}

let lastCleanup = 0;
function cleanup(db: DB, now: number): void {
  if (now - lastCleanup < 3_600_000) return;
  lastCleanup = now;
  db.prepare("delete from runs where started_at < ?").run(now - 2 * 86_400_000);
  db.prepare("delete from account_sessions where expires_at < ?").run(now);
  // players who never finished a run and haven't been seen for 30 days
  db.prepare("delete from players where seq = 0 and updated_at < ?").run(now - 30 * 86_400_000);
}

export async function handleGame(db: DB, req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!sameOrigin(req)) return json(403, { error: "origin" });

  const { body, error } = await readJson(req, MAX_BODY);
  if (error !== undefined) return json(error, { error: error === 413 ? "too_large" : "bad_request" });

  const now = Date.now();
  cleanup(db, now);
  const cookies: string[] = []; // Set-Cookie headers for the reply
  const reply = (status: number, data: unknown) => {
    const res = json(status, data);
    for (const c of cookies) res.headers.append("Set-Cookie", c);
    return res;
  };

  // which browser is this? an unknown or missing cookie gets a brand new player
  const token = readCookie(req, COOKIE);
  let playerId = isToken(token) ? sha256(token) : null;
  const getPlayer = (id: string) =>
    db.prepare("select * from players where id = ?").get(id) as PlayerRow | undefined;
  let row = playerId ? getPlayer(playerId) : undefined;
  if (!row) {
    if (limited("new:" + clientIp(req), NEW_PLAYERS_PER_IP, 600_000))
      return reply(429, { error: "rate" });
    const fresh = newToken();
    playerId = sha256(fresh);
    const p = L.newProgress();
    db.prepare(
      `insert into players (id, bests, arenas, arena, xp, skin, seq, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(playerId, JSON.stringify(p.bests), p.arenas, p.arena, p.xp, p.skin, p.seq, now, now);
    row = getPlayer(playerId)!;
    cookies.push(cookieHeader(req, COOKIE, fresh, { maxAge: COOKIE_MAX_AGE }));
  }
  const p = rowToProgress(row);

  // logged-in account (only needed for competition mode)
  const accountToken = readCookie(req, ACCOUNT_COOKIE);
  const account: AccountRow | null = accountFromToken(db, accountToken);
  const logIn = (a: AccountRow) => {
    const t = startSession(db, a.id, now);
    cookies.push(cookieHeader(req, ACCOUNT_COOKIE, t, { maxAge: ACCOUNT_SESSION_MS / 1000 }));
    return reply(200, { account: publicAccount(a) });
  };

  switch (body.action) {
    case "session":
      return reply(200, {
        progress: L.publicProgress(p),
        account: account ? publicAccount(account) : null,
      });

    case "select": {
      if (!L.canPlayArena(p, body.arena) || !L.canUseSkin(p, body.skin))
        return reply(400, { error: "locked" });
      db.prepare("update players set arena = ?, skin = ?, updated_at = ? where id = ?").run(
        body.arena,
        body.skin,
        now,
        playerId,
      );
      return reply(200, {
        progress: L.publicProgress({ ...p, arena: body.arena, skin: body.skin }),
      });
    }

    case "account-register": {
      if (limited("register:" + clientIp(req), NEW_ACCOUNTS_PER_IP, 600_000))
        return reply(429, { error: "rate" });
      const r = register(db, body, now);
      if (r.error) return reply(r.error === "taken" ? 409 : 400, { error: r.error });
      endSession(db, accountToken); // a new account replaces any old login
      return logIn(r.account);
    }

    case "account-login": {
      const ipKey = "acc-login-ip:" + clientIp(req);
      const userKey = "acc-login-user:" + String(body.username ?? "").trim().toLowerCase().slice(0, 40);
      if (
        limited(ipKey, LOGIN_FAILS_PER_IP, FAIL_WINDOW, { count: false }) ||
        limited(userKey, LOGIN_FAILS_PER_USER, FAIL_WINDOW, { count: false })
      )
        return reply(429, { error: "rate" });
      const a = login(db, body.username, body.password);
      if (!a) {
        hit(ipKey);
        hit(userKey);
        return reply(401, { error: "wrong_login" });
      }
      endSession(db, accountToken);
      return logIn(a);
    }

    case "account-logout":
      endSession(db, accountToken);
      cookies.push(cookieHeader(req, ACCOUNT_COOKIE, "", { maxAge: 0 }));
      return reply(200, {});

    case "run-start": {
      const comp = body.mode === "comp";
      if (comp && !account) return reply(401, { error: "login_required" });
      if (!comp && !L.canPlayArena(p, body.arena)) return reply(400, { error: "locked" });
      const { n } = db
        .prepare("select count(*) as n from runs where player_id = ? and started_at >= ?")
        .get(playerId, now - 60_000) as Count;
      if (n >= RUNS_PER_MINUTE) return reply(429, { error: "rate" });
      const runId = crypto.randomUUID();
      const seed = crypto.randomBytes(4).readUInt32LE(0);
      db.prepare(
        `insert into runs (id, player_id, seed, seq, arena, mode, started_at, account_id)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        runId,
        playerId,
        seed,
        p.seq,
        comp ? 0 : body.arena,
        comp ? "comp" : "normal",
        now,
        comp ? account!.id : null,
      );
      db.prepare("update players set updated_at = ? where id = ?").run(now, playerId);
      return reply(200, { runId, seed });
    }

    case "run-finish": {
      if (typeof body.runId !== "string") return reply(400, { error: "bad_request" });
      const run = db
        .prepare("select * from runs where id = ? and player_id = ?")
        .get(body.runId, playerId) as RunRow | undefined;
      if (!run || run.finished) return reply(409, { error: "stale" });

      if (run.mode === "comp") {
        // the score goes to the account that started the run
        const who = run.account_id
          ? (db.prepare("select * from accounts where id = ?").get(run.account_id) as
              | AccountRow
              | undefined)
          : undefined;
        if (!who) return reply(409, { error: "stale" }); // account deleted meanwhile
        const c = L.computeCompetition(
          { seed: run.seed, startedAt: run.started_at },
          body.inputs,
          body.frames,
          now,
        );
        if (c.error) return reply(400, { error: c.error });
        const score = c.result.score;

        // better-sqlite3 is synchronous, so this whole block runs without
        // any other request in between
        const result = db.transaction(() => {
          db.prepare("update runs set finished = 1 where id = ?").run(run.id);
          const lb = db
            .prepare("select * from leaderboard where account_id = ?")
            .get(who.id) as LeaderboardRow | undefined;
          let best = score,
            achieved = now,
            newBest = score > 0,
            hidden = false;
          if (lb) {
            hidden = !!lb.hidden;
            if (score > lb.best) newBest = true;
            else {
              best = lb.best;
              achieved = lb.achieved_at;
              newBest = false;
            }
            db.prepare(
              `update leaderboard set name = ?, klass = ?, best = ?, achieved_at = ?, updated_at = ?
               where account_id = ?`,
            ).run(who.display_name, who.klass, best, achieved, now, who.id);
          } else if (score > 0) {
            db.prepare(
              `insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at)
               values (?, ?, ?, ?, ?, ?)`,
            ).run(who.id, who.display_name, who.klass, best, achieved, now);
          }
          const rank = best > 0 && !hidden ? rankOf(db, best, achieved, null) : null;
          return { score, best, newBest, rank };
        })();
        return reply(200, { result });
      }

      const out = L.computeFinish(
        p,
        { seq: run.seq, arena: run.arena, seed: run.seed, startedAt: run.started_at },
        body.inputs,
        body.frames,
        now,
      );
      if (out.error) return reply(out.error === "stale" ? 409 : 400, { error: out.error });

      const next = out.next;
      const saved = db.transaction(() => {
        db.prepare("update runs set finished = 1 where id = ?").run(run.id);
        // only write if the progress is still the one the run started from
        const r = db
          .prepare(
            `update players set bests = ?, arenas = ?, arena = ?, xp = ?, skin = ?, seq = ?, updated_at = ?
             where id = ? and seq = ?`,
          )
          .run(JSON.stringify(next.bests), next.arenas, next.arena, next.xp, next.skin, next.seq, now, playerId, p.seq);
        return r.changes === 1;
      })();
      if (!saved) return reply(409, { error: "stale" });
      return reply(200, { progress: L.publicProgress(next), result: out.result });
    }

    case "leaderboard": {
      const klass = L.isClass(body.klass) ? body.klass : null;
      const top = db
        .prepare(
          `select account_id, name, klass, best from leaderboard
           where hidden = 0 and best > 0 ${klass ? "and klass = ?" : ""}
           order by best desc, achieved_at asc limit 50`,
        )
        .all(...(klass ? [klass] : [])) as Pick<LeaderboardRow, "account_id" | "name" | "klass" | "best">[];
      const rows = top.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        klass: r.klass,
        score: r.best,
        me: !!account && r.account_id === account.id,
      }));
      let me: { best: number; name: string; klass: string; rank: number | null } | null = null;
      const mine = account
        ? (db.prepare("select * from leaderboard where account_id = ?").get(account.id) as
            | LeaderboardRow
            | undefined)
        : undefined;
      if (mine && mine.best > 0) {
        const visible = !mine.hidden && (!klass || mine.klass === klass);
        me = {
          best: mine.best,
          name: mine.name,
          klass: mine.klass,
          rank: visible ? rankOf(db, mine.best, mine.achieved_at, klass) : null,
        };
      }
      return reply(200, { rows, me });
    }

    default:
      return reply(404, { error: "not_found" });
  }
}

// place on the leaderboard: 1 + the number of visible players ahead of this score
function rankOf(db: DB, best: number, achievedAt: number, klass: string | null): number {
  const { n } = db
    .prepare(
      `select count(*) as n from leaderboard
       where hidden = 0 and (best > ? or (best = ? and achieved_at < ?))
       ${klass ? "and klass = ?" : ""}`,
    )
    .get(best, best, achievedAt, ...(klass ? [klass] : [])) as Count;
  return n + 1;
}
