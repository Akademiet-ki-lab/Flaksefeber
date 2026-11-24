/*
  Flaksefeber backend: handles POST /api/game.

  The browser never writes progress. It sends flaps; the server replays the run
  with the shared simulation (sim.js) and writes the result itself.

  Who is playing: a random token in an httpOnly cookie. JavaScript in the page
  can't read it, and the database only stores its sha256 hash.

  POST body: { action, ... }
    session                      -> { progress }
    select    { arena, skin }    -> { progress }
    run-start { arena }          -> { runId, seed }
    run-start { mode: "comp" }   -> { runId, seed }   (competition run)
    run-finish{ runId, inputs, frames } -> { progress, result }
    run-finish{ runId, inputs, frames, name, klass } -> { result }  (competition)
    leaderboard { klass? }       -> { rows, me }
*/
import crypto from "node:crypto";
import * as L from "./logic";
import type { DB, PlayerRow, RunRow, LeaderboardRow, Count } from "./db";
import {
  json,
  fail,
  readCookie,
  cookieHeader,
  clientIp,
  limited,
  sameOrigin,
  readJson,
} from "./http";

const COOKIE = "ff_player";
const COOKIE_MAX_AGE = 5 * 365 * 86400; // seconds
const MAX_BODY = 2_000_000; // bytes; a 30-minute competition run is well below this
const RUNS_PER_MINUTE = 30;
const NEW_PLAYERS_PER_IP = 200; // per 10 minutes (a whole school can share one IP)

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

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
  // players who never finished a run and haven't been seen for 30 days
  db.prepare(
    `delete from players where seq = 0 and updated_at < ?
       and id not in (select player_id from leaderboard)`,
  ).run(now - 30 * 86_400_000);
}

export async function handleGame(db: DB, req: Request): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method");
  if (!sameOrigin(req)) return fail(403, "origin");

  const { body, error } = await readJson(req, MAX_BODY);
  if (error !== undefined) return fail(error, error === 413 ? "too_large" : "bad_request");

  const now = Date.now();
  cleanup(db, now);

  // who is this? an unknown or missing cookie gets a brand new player
  let setCookie = null;
  const token = readCookie(req, COOKIE);
  let playerId = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
  const getPlayer = (id: string) =>
    db.prepare("select * from players where id = ?").get(id) as PlayerRow | undefined;
  let row = playerId ? getPlayer(playerId) : undefined;
  if (!row) {
    if (limited("new:" + clientIp(req), NEW_PLAYERS_PER_IP, 600_000))
      return fail(429, "rate");
    const fresh = crypto.randomBytes(32).toString("base64url");
    playerId = sha256(fresh);
    const p = L.newProgress();
    db.prepare(
      `insert into players (id, bests, arenas, arena, xp, skin, seq, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(playerId, JSON.stringify(p.bests), p.arenas, p.arena, p.xp, p.skin, p.seq, now, now);
    row = getPlayer(playerId)!;
    setCookie = cookieHeader(req, COOKIE, fresh, { maxAge: COOKIE_MAX_AGE });
  }
  const reply = (status: number, data: unknown) =>
    json(status, data, setCookie ? { "Set-Cookie": setCookie } : {});
  const p = rowToProgress(row);

  switch (body.action) {
    case "session":
      return reply(200, { progress: L.publicProgress(p) });

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

    case "run-start": {
      const comp = body.mode === "comp";
      if (!comp && !L.canPlayArena(p, body.arena)) return reply(400, { error: "locked" });
      const { n } = db
        .prepare("select count(*) as n from runs where player_id = ? and started_at >= ?")
        .get(playerId, now - 60_000) as Count;
      if (n >= RUNS_PER_MINUTE) return reply(429, { error: "rate" });
      const runId = crypto.randomUUID();
      const seed = crypto.randomBytes(4).readUInt32LE(0);
      db.prepare(
        `insert into runs (id, player_id, seed, seq, arena, mode, started_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, playerId, seed, p.seq, comp ? 0 : body.arena, comp ? "comp" : "normal", now);
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
        const who = L.validCompetitor(body.name, body.klass);
        if (!who) return reply(400, { error: "bad_name" });
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
            .prepare("select * from leaderboard where player_id = ?")
            .get(playerId) as LeaderboardRow | undefined;
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
               where player_id = ?`,
            ).run(who.name, who.klass, best, achieved, now, playerId);
          } else if (score > 0) {
            db.prepare(
              `insert into leaderboard (player_id, name, klass, best, achieved_at, updated_at)
               values (?, ?, ?, ?, ?, ?)`,
            ).run(playerId, who.name, who.klass, best, achieved, now);
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

      const n = out.next;
      const saved = db.transaction(() => {
        db.prepare("update runs set finished = 1 where id = ?").run(run.id);
        // only write if the progress is still the one the run started from
        const r = db
          .prepare(
            `update players set bests = ?, arenas = ?, arena = ?, xp = ?, skin = ?, seq = ?, updated_at = ?
             where id = ? and seq = ?`,
          )
          .run(JSON.stringify(n.bests), n.arenas, n.arena, n.xp, n.skin, n.seq, now, playerId, p.seq);
        return r.changes === 1;
      })();
      if (!saved) return reply(409, { error: "stale" });
      return reply(200, { progress: L.publicProgress(n), result: out.result });
    }

    case "leaderboard": {
      const klass = L.isClass(body.klass) ? body.klass : null;
      const top = db
        .prepare(
          `select player_id, name, klass, best from leaderboard
           where hidden = 0 and best > 0 ${klass ? "and klass = ?" : ""}
           order by best desc, achieved_at asc limit 50`,
        )
        .all(...(klass ? [klass] : [])) as Pick<LeaderboardRow, "player_id" | "name" | "klass" | "best">[];
      const rows = top.map((r, i) => ({
          rank: i + 1,
          name: r.name,
          klass: r.klass,
          score: r.best,
          me: r.player_id === playerId,
        }));
      let me: { best: number; name: string; klass: string; rank: number | null } | null = null;
      const mine = db
        .prepare("select * from leaderboard where player_id = ?")
        .get(playerId) as LeaderboardRow | undefined;
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
