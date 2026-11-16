// Flaksefeber backend (Supabase Edge Function).
//
// The browser never writes progress. It sends flaps; this function replays the
// run with the shared simulation and writes the result with the service role.
//
// POST body: { action, ... }
//   session                      -> { progress }
//   select    { arena, skin }    -> { progress }
//   run-start { arena }          -> { runId, seed }
//   run-finish{ runId, inputs, frames } -> { progress, result }
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
      if (!L.canPlayArena(p, body.arena)) return fail(400, "locked");
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
        .insert({ user_id: userId, seed, seq: p.seq, arena: body.arena })
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

    default:
      return fail(404, "not_found");
  }
});
