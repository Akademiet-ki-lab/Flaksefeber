// Flaksefeber backend (Supabase Edge Function).
//
// The browser never writes progress. It sends flaps; this function replays the
// run with the shared simulation and writes the result with the service role.
//
// POST body: { action, ... }
//   session                      -> { progress }
//   select    { arena, skin }    -> { progress }
//   run-start { arena }          -> { runId, seed }
//   run-start { mode: "comp" }   -> { runId, seed }   (competition run)
//   run-finish{ runId, inputs, frames } -> { progress, result }
//   run-finish{ runId, inputs, frames, name, klass } -> { result }  (competition)
//   leaderboard { klass? }       -> { rows, me }
import { createClient } from "npm:@supabase/supabase-js@2";
import "./sim.js";
import "./logic.js";

// deno-lint-ignore no-explicit-any
const L = (globalThis as any).GameLogic;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
const fail = (status: number, error: string) => json(status, { error });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// deno-lint-ignore no-explicit-any
type Row = any;

async function getProgress(userId: string): Promise<Row | null> {
  const read = () =>
    admin.from("progress").select("*").eq("user_id", userId).maybeSingle();
  let { data, error } = await read();
  if (error) return null;
  if (!data) {
    // first visit: create the default row (a parallel request may win, that's fine)
    await admin
      .from("progress")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    ({ data, error } = await read());
    if (error) return null;
  }
  return data;
}

// place on the leaderboard: 1 + the number of visible players ahead of this score
async function rankOf(best: number, achievedAt: string, klass: string | null) {
  let q = admin
    .from("leaderboard")
    .select("user_id", { count: "exact", head: true })
    .eq("hidden", false)
    .or(`best.gt.${best},and(best.eq.${best},achieved_at.lt."${achievedAt}")`);
  if (klass) q = q.eq("klass", klass);
  const { count, error } = await q;
  return error ? null : (count ?? 0) + 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method");

  // who is this? (anonymous or normal user, checked against Supabase Auth)
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "no_token");
  const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !auth?.user) return fail(401, "invalid_token");
  const userId = auth.user.id;

  let body: Row;
  try {
    body = await req.json();
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return fail(400, "bad_request");
  }

  const p = await getProgress(userId);
  if (!p) return fail(500, "db");

  switch (body.action) {
    case "session":
      return json(200, { progress: L.publicProgress(p) });

    case "select": {
      if (!L.canPlayArena(p, body.arena) || !L.canUseSkin(p, body.skin))
        return fail(400, "locked");
      const { data, error } = await admin
        .from("progress")
        .update({ arena: body.arena, skin: body.skin, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) return fail(500, "db");
      return json(200, { progress: L.publicProgress(data) });
    }

    case "run-start": {
      const comp = body.mode === "comp";
      if (!comp && !L.canPlayArena(p, body.arena)) return fail(400, "locked");
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await admin
        .from("runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("started_at", since);
      if ((count ?? 0) >= 30) return fail(429, "rate");
      // tidy up this player's old runs
      await admin
        .from("runs")
        .delete()
        .eq("user_id", userId)
        .lt("started_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const { data, error } = await admin
        .from("runs")
        .insert({
          user_id: userId,
          seed,
          seq: p.seq,
          arena: comp ? 0 : body.arena,
          mode: comp ? "comp" : "normal",
        })
        .select("id")
        .single();
      if (error) return fail(500, "db");
      return json(200, { runId: data.id, seed });
    }

    case "run-finish": {
      if (typeof body.runId !== "string") return fail(400, "bad_request");
      const { data: run } = await admin
        .from("runs")
        .select("*")
        .eq("id", body.runId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!run || run.finished) return fail(409, "stale");

      if (run.mode === "comp") {
        const who = L.validCompetitor(body.name, body.klass);
        if (!who) return fail(400, "bad_name");
        const c = L.computeCompetition(
          { seed: Number(run.seed), startedAt: Date.parse(run.started_at) },
          body.inputs,
          body.frames,
          Date.now(),
        );
        if (c.error) return fail(400, c.error);
        const score: number = c.result.score;

        const { data: claimed } = await admin
          .from("runs")
          .update({ finished: true })
          .eq("id", run.id)
          .eq("finished", false)
          .select("id");
        if (!claimed?.length) return fail(409, "stale");

        const { data: row } = await admin
          .from("leaderboard")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        const now = new Date().toISOString();
        let best = score;
        let achieved = now;
        let newBest = score > 0;
        let hidden = false;
        if (row) {
          hidden = row.hidden;
          if (score > row.best) {
            newBest = true;
          } else {
            best = row.best;
            achieved = row.achieved_at;
            newBest = false;
          }
          const { error } = await admin
            .from("leaderboard")
            .update({
              name: who.name,
              klass: who.klass,
              best,
              achieved_at: achieved,
              updated_at: now,
            })
            .eq("user_id", userId);
          if (error) return fail(500, "db");
        } else if (score > 0) {
          const { error } = await admin.from("leaderboard").insert({
            user_id: userId,
            name: who.name,
            klass: who.klass,
            best,
            achieved_at: achieved,
          });
          if (error) return fail(500, "db");
        }
        const rank = best > 0 && !hidden ? await rankOf(best, achieved, null) : null;
        return json(200, { result: { score, best, newBest, rank } });
      }

      const out = L.computeFinish(
        p,
        {
          seq: run.seq,
          arena: run.arena,
          seed: Number(run.seed),
          startedAt: Date.parse(run.started_at),
        },
        body.inputs,
        body.frames,
        Date.now(),
      );
      if (out.error) return fail(out.error === "stale" ? 409 : 400, out.error);

      // each run counts once
      const { data: claimed } = await admin
        .from("runs")
        .update({ finished: true })
        .eq("id", run.id)
        .eq("finished", false)
        .select("id");
      if (!claimed?.length) return fail(409, "stale");

      // only write if the progress is still the one the run started from
      const n = out.next;
      const { data: saved, error } = await admin
        .from("progress")
        .update({
          bests: n.bests,
          arenas: n.arenas,
          arena: n.arena,
          xp: n.xp,
          skin: n.skin,
          seq: n.seq,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("seq", p.seq)
        .select("*");
      if (error) return fail(500, "db");
      if (!saved?.length) return fail(409, "stale");
      return json(200, { progress: L.publicProgress(saved[0]), result: out.result });
    }

    case "leaderboard": {
      const klass = L.isClass(body.klass) ? body.klass : null;
      let q = admin
        .from("leaderboard")
        .select("user_id,name,klass,best")
        .eq("hidden", false)
        .gt("best", 0)
        .order("best", { ascending: false })
        .order("achieved_at", { ascending: true })
        .limit(50);
      if (klass) q = q.eq("klass", klass);
      const { data, error } = await q;
      if (error) return fail(500, "db");
      const rows = (data ?? []).map((r: Row, i: number) => ({
        rank: i + 1,
        name: r.name,
        klass: r.klass,
        score: r.best,
        me: r.user_id === userId,
      }));
      let me: Row = null;
      const { data: mine } = await admin
        .from("leaderboard")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (mine && mine.best > 0) {
        const visible = !mine.hidden && (!klass || mine.klass === klass);
        me = {
          best: mine.best,
          name: mine.name,
          klass: mine.klass,
          rank: visible ? await rankOf(mine.best, mine.achieved_at, klass) : null,
        };
      }
      return json(200, { rows, me });
    }

    default:
      return fail(404, "not_found");
  }
});
